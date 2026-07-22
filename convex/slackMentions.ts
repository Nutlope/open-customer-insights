import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAuthenticated } from "../lib/convex/auth";
import {
  requireSlackToken,
  getSlackToken,
  slackFetch,
  cleanSlackText,
  resolveUserMentionsInText,
  slackTsToIso,
  buildWatchlistEntry,
  matchWatchlistEntries,
  EXCLUDED_SLACK_MENTION_CHANNELS,
  type SlackHistoryMessage,
} from "../lib/convex/slack";
import { filterGenuineCompanyMentions, type SlackMentionCandidate } from "../lib/convex/slackMentionFilter";
import { hasTogetherCredentials } from "../lib/integrations";

// One conversations.history call per joined channel per day, regardless of
// how many companies are on the watchlist — this is what keeps Slack
// rate-limit usage bounded.
const SCAN_CONCURRENCY = 8;
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MESSAGES_PER_CHANNEL = 200;

type SlackConversationsHistory = {
  messages?: SlackHistoryMessage[];
};

export const listChannelScanStatesInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("slackChannelScanState").collect();
  },
});

export const upsertChannelScanStateInternal = internalMutation({
  args: {
    channelId: v.string(),
    lastScannedTs: v.string(),
  },
  handler: async (ctx, { channelId, lastScannedTs }) => {
    const existing = await ctx.db
      .query("slackChannelScanState")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { lastScannedTs, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("slackChannelScanState", { channelId, lastScannedTs, updatedAt: Date.now() });
    }
  },
});

export const insertSlackMentionsInternal = internalMutation({
  args: {
    mentions: v.array(v.object({
      companyId: v.id("companyProfiles"),
      domain: v.string(),
      channelId: v.string(),
      channelName: v.optional(v.string()),
      messageTs: v.string(),
      threadTs: v.string(),
      text: v.string(),
      matchedTerms: v.array(v.string()),
      authorName: v.optional(v.string()),
      authorUserId: v.optional(v.string()),
      postedAt: v.string(),
    })),
  },
  handler: async (ctx, { mentions }) => {
    let inserted = 0;
    for (const mention of mentions) {
      const existingForMessage = await ctx.db
        .query("slackCompanyMentions")
        .withIndex("by_channel_message", (q) => q.eq("channelId", mention.channelId).eq("messageTs", mention.messageTs))
        .collect();
      const existingMatch = existingForMessage.find((e) => e.companyId === mention.companyId);
      if (existingMatch) {
        const patch: Record<string, string> = {};
        // Backfill authorUserId on records stored before we tracked it
        if (mention.authorUserId && !existingMatch.authorUserId) {
          patch.authorUserId = mention.authorUserId;
        }
        // Update text if the new version has resolved user names (no @[user] placeholders)
        if (mention.text && !mention.text.includes("@[user]") && existingMatch.text.includes("@[user]")) {
          patch.text = mention.text;
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existingMatch._id, patch);
        }
        continue;
      }

      await ctx.db.insert("slackCompanyMentions", { ...mention, createdAt: Date.now() });
      inserted++;
    }
    return inserted;
  },
});

type MentionRecord = {
  companyId: Id<"companyProfiles">;
  domain: string;
  channelId: string;
  channelName: string | undefined;
  messageTs: string;
  threadTs: string;
  text: string;
  matchedTerms: string[];
  authorUserId: string | undefined;
  authorName: string | undefined;
  postedAt: string;
};

// Daily cron (see convex/crons.ts): scans every joined Slack channel once for
// messages since its last scan (or the last 24h on first run), matches them
// against the Slack-mention watchlist (convex/companies.ts
// listSlackWatchlistCompaniesInternal — prospects + top companies by recent
// activity and lifetime revenue), asks a cheap LLM to drop messages that only
// coincidentally match a company's name/domain (see
// lib/convex/slackMentionFilter.ts), and stores the rest in
// slackCompanyMentions.
export const scanSlackMentionsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ channelsScanned: number; mentionsFound: number }> => {
    if (!getSlackToken() || !hasTogetherCredentials()) {
      return { channelsScanned: 0, mentionsFound: 0 };
    }
    const token = requireSlackToken();
    const allChannels = await ctx.runQuery(internal.slack.getCachedJoinedChannels, {});
    const channels = allChannels.filter((channel) => !channel.name || !EXCLUDED_SLACK_MENTION_CHANNELS.has(channel.name));
    const watchlist = await ctx.runQuery(internal.companies.listSlackWatchlistCompaniesInternal, {});
    if (channels.length === 0 || watchlist.length === 0) return { channelsScanned: 0, mentionsFound: 0 };

    const companyNameById = new Map(watchlist.map((company) => [company._id, company.name]));
    const entries = watchlist
      .map((company) => buildWatchlistEntry({ companyId: company._id, domain: company.domain, name: company.name }))
      .filter((entry) => entry.terms.length > 0);

    const cachedUsers = await ctx.runQuery(internal.slack.listAllSlackUserCacheInternal, {});
    const userDisplayNames = new Map(cachedUsers.map((u) => [
      u.userId,
      u.displayName || u.realName || u.username,
    ]));

    const scanStates = await ctx.runQuery(internal.slackMentions.listChannelScanStatesInternal, {});
    const scanStateByChannel = new Map(scanStates.map((state) => [state.channelId, state.lastScannedTs]));

    let channelsScanned = 0;
    const candidateMentions: MentionRecord[] = [];

    for (let start = 0; start < channels.length; start += SCAN_CONCURRENCY) {
      const batch = channels.slice(start, start + SCAN_CONCURRENCY);
      await Promise.all(batch.map(async (channel) => {
        const previousScanTs = scanStateByChannel.get(channel.channelId);
        const oldest = previousScanTs ?? String((Date.now() - INITIAL_LOOKBACK_MS) / 1000);

        const history = await slackFetch<SlackConversationsHistory>({
          token,
          method: "conversations.history",
          params: { channel: channel.channelId, oldest, limit: MESSAGES_PER_CHANNEL },
        }).catch(() => null);
        channelsScanned++;
        if (!history?.ok) return;

        let latestTs = previousScanTs;

        for (const message of history.messages ?? []) {
          if (!message.ts) continue;
          if (!latestTs || message.ts > latestTs) latestTs = message.ts;

          const text = cleanSlackText({ text: resolveUserMentionsInText({ text: message.text ?? "", userDisplayNames }) });
          if (!text) continue;

          for (const match of matchWatchlistEntries({ text, entries })) {
            candidateMentions.push({
              companyId: match.companyId,
              domain: match.domain,
              channelId: channel.channelId,
              channelName: channel.name,
              messageTs: message.ts,
              threadTs: message.thread_ts || message.ts,
              text,
              matchedTerms: match.matchedTerms,
              authorName: message.username,
              authorUserId: message.user,
              postedAt: slackTsToIso({ ts: message.ts }) ?? new Date().toISOString(),
            });
          }
        }

        if (latestTs && latestTs !== previousScanTs) {
          await ctx.runMutation(internal.slackMentions.upsertChannelScanStateInternal, {
            channelId: channel.channelId,
            lastScannedTs: latestTs,
          });
        }
      }));
    }

    let mentionsFound = 0;
    if (candidateMentions.length > 0) {
      const candidates: SlackMentionCandidate[] = candidateMentions.map((mention) => ({
        text: mention.text,
        companyName: companyNameById.get(mention.companyId) ?? mention.domain,
        domain: mention.domain,
        matchedTerms: mention.matchedTerms,
      }));
      const confirmed = await filterGenuineCompanyMentions({ candidates });
      const genuineMentions = candidateMentions.filter((_, i) => confirmed[i]);
      if (genuineMentions.length > 0) {
        mentionsFound = await ctx.runMutation(internal.slackMentions.insertSlackMentionsInternal, { mentions: genuineMentions });
      }
    }

    return { channelsScanned, mentionsFound };
  },
});

// Rescans a single channel's full history up to `lookbackDays` (default 90).
// Use this to backfill mentions from channels that were recently joined or
// whose initial 24h scan window missed older messages.
export const rescanChannelHistoryInternal = internalAction({
  args: {
    channelName: v.string(),
    lookbackDays: v.optional(v.number()),
  },
  handler: async (ctx, { channelName, lookbackDays = 90 }): Promise<{ mentionsFound: number; messagesScanned: number }> => {
    const token = requireSlackToken();

    const channel = await ctx.runQuery(internal.slackMentions.getChannelByNameInternal, { name: channelName });
    if (!channel) throw new Error(`Channel "${channelName}" not found in cache`);

    const watchlist = await ctx.runQuery(internal.companies.listSlackWatchlistCompaniesInternal, {});
    const companyNameById = new Map(watchlist.map((c) => [c._id, c.name]));
    const entries = watchlist
      .map((c) => buildWatchlistEntry({ companyId: c._id, domain: c.domain, name: c.name }))
      .filter((e) => e.terms.length > 0);

    const cachedUsers = await ctx.runQuery(internal.slack.listAllSlackUserCacheInternal, {});
    const userDisplayNames = new Map(cachedUsers.map((u) => [
      u.userId,
      u.displayName || u.realName || u.username,
    ]));

    const oldest = String((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
    const candidateMentions: MentionRecord[] = [];
    let messagesScanned = 0;
    let cursor: string | undefined;

    // Paginate through history — Slack returns up to 200 messages per call
    do {
      const params: Record<string, string | number> = { channel: channel.channelId, oldest, limit: 200 };
      if (cursor) params.cursor = cursor;
      const history = await slackFetch<SlackConversationsHistory & { response_metadata?: { next_cursor?: string } }>({
        token,
        method: "conversations.history",
        params,
      }).catch(() => null);
      if (!history?.ok) break;

      let latestTs: string | undefined;
      for (const message of history.messages ?? []) {
        if (!message.ts) continue;
        messagesScanned++;
        if (!latestTs || message.ts > latestTs) latestTs = message.ts;
        const text = cleanSlackText({ text: resolveUserMentionsInText({ text: message.text ?? "", userDisplayNames }) });
        if (!text) continue;
        for (const match of matchWatchlistEntries({ text, entries })) {
          candidateMentions.push({
            companyId: match.companyId,
            domain: match.domain,
            channelId: channel.channelId,
            channelName: channel.name,
            messageTs: message.ts,
            threadTs: message.thread_ts || message.ts,
            text,
            matchedTerms: match.matchedTerms,
            authorName: message.username,
            authorUserId: message.user,
            postedAt: slackTsToIso({ ts: message.ts }) ?? new Date().toISOString(),
          });
        }
      }

      if (latestTs) {
        await ctx.runMutation(internal.slackMentions.upsertChannelScanStateInternal, {
          channelId: channel.channelId,
          lastScannedTs: latestTs,
        });
      }

      cursor = history.response_metadata?.next_cursor ?? undefined;
    } while (cursor);

    if (candidateMentions.length === 0) return { mentionsFound: 0, messagesScanned };

    const candidates: SlackMentionCandidate[] = candidateMentions.map((m) => ({
      text: m.text,
      companyName: companyNameById.get(m.companyId) ?? m.domain,
      domain: m.domain,
      matchedTerms: m.matchedTerms,
    }));
    const confirmed = await filterGenuineCompanyMentions({ candidates });
    const genuineMentions = candidateMentions.filter((_, i) => confirmed[i]);
    let mentionsFound = 0;
    if (genuineMentions.length > 0) {
      mentionsFound = await ctx.runMutation(internal.slackMentions.insertSlackMentionsInternal, {
        mentions: genuineMentions,
      });
    }

    console.log(`[rescan] #${channelName}: scanned=${messagesScanned} candidates=${candidateMentions.length} confirmed=${mentionsFound}`);
    return { mentionsFound, messagesScanned };
  },
});

// Rescans ALL joined channels with a longer lookback. Skips excluded channels.
// Use this to backfill history when the daily 24h scan has been missing older messages.
export const rescanAllChannelsHistoryInternal = internalAction({
  args: { lookbackDays: v.optional(v.number()) },
  handler: async (ctx, { lookbackDays = 90 }): Promise<{ channelsScanned: number; totalMentions: number }> => {
    const allChannels = await ctx.runQuery(internal.slack.getCachedJoinedChannels, {});
    const channels = allChannels.filter((c) => !c.name || !EXCLUDED_SLACK_MENTION_CHANNELS.has(c.name));

    let totalMentions = 0;
    for (const channel of channels) {
      if (!channel.name) continue;
      try {
        const result: { mentionsFound: number; messagesScanned: number } = await ctx.runAction(
          internal.slackMentions.rescanChannelHistoryInternal,
          { channelName: channel.name, lookbackDays }
        );
        totalMentions += result.mentionsFound;
      } catch (err) {
        console.error(`[rescan-all] Failed for #${channel.name}:`, err);
      }
    }
    return { channelsScanned: channels.length, totalMentions };
  },
});

export const deleteSlackMentionsByChannelInternal = internalMutation({
  args: { channelName: v.string() },
  handler: async (ctx, { channelName }): Promise<number> => {
    const mentions = await ctx.db
      .query("slackCompanyMentions")
      .filter((q) => q.eq(q.field("channelName"), channelName))
      .collect();
    for (const m of mentions) {
      await ctx.db.delete(m._id);
    }
    return mentions.length;
  },
});

export const getChannelByNameInternal = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    return ctx.db
      .query("slackChannelCache")
      .filter((q) => q.eq(q.field("name"), name))
      .first();
  },
});

export const getCompanySlackMentions = query({
  args: {
    companyId: v.id("companyProfiles"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit = 20 }) => {
    await requireAuthenticated({ ctx });
    const mentions = await ctx.db
      .query("slackCompanyMentions")
      .withIndex("by_company_posted", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(limit);

    return Promise.all(
      mentions.map(async (mention) => {
        let resolvedAuthorName: string | undefined = mention.authorName;
        let avatarUrl: string | undefined;
        if (mention.authorUserId) {
          const user = await ctx.db
            .query("slackUserCache")
            .withIndex("by_user", (q) => q.eq("userId", mention.authorUserId!))
            .unique();
          if (user) {
            resolvedAuthorName = user.displayName || user.realName || user.username;
            avatarUrl = user.avatarUrl;
          }
        }
        return { ...mention, resolvedAuthorName, avatarUrl };
      })
    );
  },
});
