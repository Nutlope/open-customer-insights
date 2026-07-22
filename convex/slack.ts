import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAuthenticated } from "../lib/convex/auth";
import {
  getSlackWorkspaceUsers,
  getJoinedSlackChannels,
  getSlackChannelHistory,
  getSlackThread,
  getSlackToken,
  requireSlackToken,
  resolveSlackUserFromApi,
  searchJoinedSlackChannels,
  type ResolvedSlackUser,
  type SlackChannelHistoryResult,
  type SlackChannel,
  type SlackSearchResult,
  type SlackThreadResult,
} from "../lib/convex/slack";

const SLACK_CHANNEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SLACK_USER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLACK_CHANNEL_CACHE_META_KEY = "channels";
const SLACK_USER_DIRECTORY_CACHE_META_KEY = "user-directory";

function organizationEmailDomains(): string[] {
  return (process.env.ORGANIZATION_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

function isOrganizationEmail({ email }: { email?: string }): boolean {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return false;
  return organizationEmailDomains().some((domain) => normalizedEmail.endsWith(`@${domain}`));
}

function channelFromCache({ channel }: { channel: Doc<"slackChannelCache"> }): SlackChannel {
  return {
    id: channel.channelId,
    name: channel.name,
    is_member: channel.isJoined,
    is_private: channel.isPrivate,
    num_members: channel.memberCount,
  };
}

export const getCachedJoinedChannels = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Doc<"slackChannelCache">>> => {
    return await ctx.db
      .query("slackChannelCache")
      .withIndex("by_joined", (q) => q.eq("isJoined", true))
      .collect();
  },
});

export const getChannelCacheRefreshedAt = internalQuery({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const meta = await ctx.db
      .query("slackCacheMeta")
      .withIndex("by_key", (q) => q.eq("key", SLACK_CHANNEL_CACHE_META_KEY))
      .unique();
    return meta?.refreshedAt ?? null;
  },
});

export const replaceSlackChannelCache = internalMutation({
  args: {
    channels: v.array(v.object({
      id: v.string(),
      name: v.optional(v.string()),
      isPrivate: v.optional(v.boolean()),
      memberCount: v.optional(v.number()),
      isJoined: v.boolean(),
    })),
  },
  handler: async (ctx, args): Promise<number> => {
    const now = Date.now();
    const incomingIds = new Set(args.channels.map((channel) => channel.id));
    for (const channel of args.channels) {
      const existing = await ctx.db
        .query("slackChannelCache")
        .withIndex("by_channel", (q) => q.eq("channelId", channel.id))
        .unique();
      const patch = {
        name: channel.name,
        isPrivate: channel.isPrivate,
        memberCount: channel.memberCount,
        isJoined: channel.isJoined,
        refreshedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("slackChannelCache", {
          channelId: channel.id,
          ...patch,
        });
      }
    }

    // Evict channels the bot has left: any cached row still flagged joined but
    // absent from the fresh list must be marked not-joined so stale channels
    // stop being served by getCachedJoinedChannels.
    const previouslyJoined = await ctx.db
      .query("slackChannelCache")
      .withIndex("by_joined", (q) => q.eq("isJoined", true))
      .collect();
    for (const channel of previouslyJoined) {
      if (!incomingIds.has(channel.channelId)) {
        await ctx.db.patch(channel._id, { isJoined: false, refreshedAt: now });
      }
    }

    const meta = await ctx.db
      .query("slackCacheMeta")
      .withIndex("by_key", (q) => q.eq("key", SLACK_CHANNEL_CACHE_META_KEY))
      .unique();
    if (meta) {
      await ctx.db.patch(meta._id, { refreshedAt: now });
    } else {
      await ctx.db.insert("slackCacheMeta", {
        key: SLACK_CHANNEL_CACHE_META_KEY,
        refreshedAt: now,
      });
    }

    return args.channels.length;
  },
});

export const getCachedSlackUsers = internalQuery({
  args: {
    userIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Array<Doc<"slackUserCache">>> => {
    const cached = await Promise.all(args.userIds.map((userId) => (
      ctx.db
        .query("slackUserCache")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique()
    )));
    return cached.filter((user): user is Doc<"slackUserCache"> => user !== null);
  },
});

export const listAllSlackUserCacheInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ userId: string; displayName?: string; realName?: string; username: string }>> => {
    const users = await ctx.db.query("slackUserCache").collect();
    return users.map((u) => ({
      userId: u.userId,
      displayName: u.displayName,
      realName: u.realName,
      username: u.username,
    }));
  },
});

export const upsertSlackUserCache = internalMutation({
  args: {
    users: v.array(v.object({
      userId: v.string(),
      username: v.string(),
      email: v.optional(v.string()),
      realName: v.optional(v.string()),
      displayName: v.optional(v.string()),
      avatarUrl: v.optional(v.string()),
      isBot: v.optional(v.boolean()),
      deleted: v.optional(v.boolean()),
      isRestricted: v.optional(v.boolean()),
      isUltraRestricted: v.optional(v.boolean()),
      isStranger: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args): Promise<number> => {
    const now = Date.now();
    for (const user of args.users) {
      const existing = await ctx.db
        .query("slackUserCache")
        .withIndex("by_user", (q) => q.eq("userId", user.userId))
        .unique();
      const patch = {
        username: user.username,
        email: user.email,
        realName: user.realName,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isBot: user.isBot,
        deleted: user.deleted,
        isRestricted: user.isRestricted,
        isUltraRestricted: user.isUltraRestricted,
        isStranger: user.isStranger,
        refreshedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, patch);
      } else {
        await ctx.db.insert("slackUserCache", {
          userId: user.userId,
          ...patch,
        });
      }
    }
    return args.users.length;
  },
});

export const updateSlackUserDirectoryCacheMeta = internalMutation({
  args: {
    refreshedAt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const meta = await ctx.db
      .query("slackCacheMeta")
      .withIndex("by_key", (q) => q.eq("key", SLACK_USER_DIRECTORY_CACHE_META_KEY))
      .unique();
    if (meta) {
      await ctx.db.patch(meta._id, { refreshedAt: args.refreshedAt });
    } else {
      await ctx.db.insert("slackCacheMeta", {
        key: SLACK_USER_DIRECTORY_CACHE_META_KEY,
        refreshedAt: args.refreshedAt,
      });
    }
  },
});

async function refreshSlackUserDirectoryFromApi({ ctx }: { ctx: ActionCtx }): Promise<{
  users: number;
  activeHumans: number;
  emails: number;
  organizationEmails: number;
}> {
  const token = requireSlackToken();
  const users = await getSlackWorkspaceUsers({ token, includeDeleted: true });
  await ctx.runMutation(internal.slack.upsertSlackUserCache, { users });
  await ctx.runMutation(internal.slack.updateSlackUserDirectoryCacheMeta, { refreshedAt: Date.now() });

  const activeHumans = users.filter((user) => !user.deleted && !user.isBot).length;
  const emails = users.filter((user) => Boolean(user.email)).length;
  const organizationEmails = users.filter((user) => isOrganizationEmail({ email: user.email })).length;
  return {
    users: users.length,
    activeHumans,
    emails,
    organizationEmails,
  };
}

// Cron-driven cache refresh: re-fetches the joined channel list from Slack
// and replaces the cache, independent of the on-demand TTL check below.
export const refreshSlackChannelCache = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const token = getSlackToken();
    if (!token) return 0;
    const channels = await getJoinedSlackChannels({ token, channelLimit: 5000 });
    return await ctx.runMutation(internal.slack.replaceSlackChannelCache, {
      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private,
        memberCount: channel.num_members,
        isJoined: Boolean(channel.is_member),
      })),
    });
  },
});

export const refreshSlackUserDirectoryInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    users: number;
    activeHumans: number;
    emails: number;
    organizationEmails: number;
  }> => {
    if (!getSlackToken()) {
      return { users: 0, activeHumans: 0, emails: 0, organizationEmails: 0 };
    }
    return await refreshSlackUserDirectoryFromApi({ ctx });
  },
});

export const refreshSlackUserDirectory = action({
  args: {
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    users: number;
    activeHumans: number;
    emails: number;
    organizationEmails: number;
  }> => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    return await refreshSlackUserDirectoryFromApi({ ctx });
  },
});

async function getFreshJoinedChannels({
  ctx,
  token,
}: {
  ctx: ActionCtx;
  token: string;
}): Promise<SlackChannel[]> {
  const refreshedAt = await ctx.runQuery(internal.slack.getChannelCacheRefreshedAt, {});
  if (refreshedAt !== null && Date.now() - refreshedAt < SLACK_CHANNEL_CACHE_TTL_MS) {
    const cached = await ctx.runQuery(internal.slack.getCachedJoinedChannels, {});
    return cached.map((channel) => channelFromCache({ channel }));
  }

  const channels = await getJoinedSlackChannels({ token, channelLimit: 5000 });
  await ctx.runMutation(internal.slack.replaceSlackChannelCache, {
    channels: channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      isPrivate: channel.is_private,
      memberCount: channel.num_members,
      isJoined: Boolean(channel.is_member),
    })),
  });
  return channels;
}

function uniqueSlackUserIdsFromText({ text }: { text?: string }): string[] {
  return [...(text ?? "").matchAll(/@([UBW][A-Z0-9]+)/g)]
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id));
}

function userFromCache({ user }: { user: Doc<"slackUserCache"> }): ResolvedSlackUser {
  return {
    userId: user.userId,
    username: user.username,
    realName: user.realName,
    displayName: user.displayName,
    isBot: user.isBot,
  };
}

function replaceSlackMentions({
  text,
  users,
}: {
  text: string;
  users: Map<string, ResolvedSlackUser>;
}): string {
  return text.replace(/@([UBW][A-Z0-9]+)/g, (mention, userId: string) => {
    const user = users.get(userId);
    return user ? `@${user.username}` : mention;
  });
}

async function resolveSlackUsers({
  ctx,
  token,
  userIds,
}: {
  ctx: ActionCtx;
  token: string;
  userIds: string[];
}): Promise<Map<string, ResolvedSlackUser>> {
  const uniqueUserIds = [...new Set(userIds.filter((userId) => /^[UBW]/.test(userId)))];
  if (uniqueUserIds.length === 0) return new Map();

  const cached = await ctx.runQuery(internal.slack.getCachedSlackUsers, { userIds: uniqueUserIds });
  const cachedById = new Map(cached.map((user) => [user.userId, user]));
  const freshUsers = new Map<string, ResolvedSlackUser>();
  const staleOrMissing = uniqueUserIds.filter((userId) => {
    const user = cachedById.get(userId);
    if (!user) return true;
    if (Date.now() - user.refreshedAt >= SLACK_USER_CACHE_TTL_MS) return true;
    freshUsers.set(userId, userFromCache({ user }));
    return false;
  });

  const resolved = await Promise.all(staleOrMissing.map(async (userId) => {
    try {
      return { user: await resolveSlackUserFromApi({ token, userId }), cacheable: true };
    } catch {
      // Transient failure (rate limit, internal error, …): use a raw-id fallback
      // for this request only, but do NOT cache it — otherwise a momentary blip
      // would mask the real name for the full cache TTL.
      return { user: { userId, username: userId } as ResolvedSlackUser, cacheable: false };
    }
  }));

  const toCache = resolved.filter((entry) => entry.cacheable).map((entry) => entry.user);
  if (toCache.length > 0) {
    await ctx.runMutation(internal.slack.upsertSlackUserCache, { users: toCache });
  }
  for (const { user } of resolved) freshUsers.set(user.userId, user);

  return freshUsers;
}

async function enrichSlackSearchResult({
  ctx,
  token,
  result,
}: {
  ctx: ActionCtx;
  token: string;
  result: SlackSearchResult;
}): Promise<SlackSearchResult> {
  const userIds = result.matches.flatMap((match) => [
    match.userId,
    match.botId,
    ...uniqueSlackUserIdsFromText({ text: match.text }),
  ]).filter((userId): userId is string => Boolean(userId));
  const users = await resolveSlackUsers({ ctx, token, userIds });
  return {
    ...result,
    matches: result.matches.map((match) => {
      const author = match.userId ? users.get(match.userId) : match.botId ? users.get(match.botId) : undefined;
      return {
        ...match,
        authorName: author?.username ?? match.authorName,
        text: replaceSlackMentions({ text: match.text, users }),
      };
    }),
  };
}

async function enrichSlackThreadResult({
  ctx,
  token,
  result,
}: {
  ctx: ActionCtx;
  token: string;
  result: SlackThreadResult;
}): Promise<SlackThreadResult> {
  const userIds = result.messages.flatMap((message) => [
    message.user,
    message.botId,
    ...uniqueSlackUserIdsFromText({ text: message.text }),
  ]).filter((userId): userId is string => Boolean(userId));
  const users = await resolveSlackUsers({ ctx, token, userIds });
  return {
    ...result,
    messages: result.messages.map((message) => {
      const author = message.user ? users.get(message.user) : message.botId ? users.get(message.botId) : undefined;
      return {
        ...message,
        authorName: author?.username ?? message.authorName ?? message.username,
        text: replaceSlackMentions({ text: message.text, users }),
      };
    }),
  };
}

async function enrichSlackChannelHistoryResult({
  ctx,
  token,
  result,
}: {
  ctx: ActionCtx;
  token: string;
  result: SlackChannelHistoryResult;
}): Promise<SlackChannelHistoryResult> {
  const enrichedThread = await enrichSlackThreadResult({
    ctx,
    token,
    result: {
      id: `slack-channel:${result.channelId}`,
      channelId: result.channelId,
      threadTs: "",
      messages: result.messages,
    },
  });
  return {
    ...result,
    messages: enrichedThread.messages,
  };
}

function findJoinedChannel({
  channels,
  channelId,
  channelName,
}: {
  channels: SlackChannel[];
  channelId?: string;
  channelName?: string;
}): SlackChannel {
  const normalizedName = channelName?.trim().replace(/^#/, "").toLowerCase();
  const channel = channels.find((item) => (
    (channelId && item.id === channelId) ||
    (normalizedName && item.name?.toLowerCase() === normalizedName)
  ));
  if (!channel) throw new Error("Slack channel not found in joined channels.");
  return channel;
}

export const searchJoinedChannels = action({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    companyName: v.optional(v.string()),
    domain: v.optional(v.string()),
    query: v.optional(v.string()),
    channelName: v.optional(v.string()),
    channelLimit: v.optional(v.number()),
    messagesPerChannel: v.optional(v.number()),
    maxMatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SlackSearchResult> => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    const token = requireSlackToken();
    const channels = await getFreshJoinedChannels({ ctx, token });
    const result = await searchJoinedSlackChannels({
      token,
      channels,
      companyName: args.companyName,
      domain: args.domain,
      query: args.query,
      channelName: args.channelName,
      channelLimit: args.channelLimit,
      messagesPerChannel: args.messagesPerChannel,
      maxMatches: args.maxMatches,
    });
    return await enrichSlackSearchResult({ ctx, token, result });
  },
});

export const listJoinedChannels = action({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<{
    id: string;
    name?: string;
    isPrivate?: boolean;
    memberCount?: number;
  }>> => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    const token = requireSlackToken();
    const channels = await getFreshJoinedChannels({ ctx, token });
    const normalizedQuery = args.query?.trim().replace(/^#/, "").toLowerCase();
    return channels
      .filter((channel) => !normalizedQuery || channel.name?.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
      .slice(0, Math.max(1, Math.min(args.limit ?? 50, 100)))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private,
        memberCount: channel.num_members,
      }));
  },
});

export const getJoinedChannelStats = action({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ joinedChannelCount: number; channelNames: string[] }> => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    const token = requireSlackToken();
    const channels = await getFreshJoinedChannels({ ctx, token });
    const channelNames = channels
      .map((channel) => channel.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 5);
    return { joinedChannelCount: channels.length, channelNames };
  },
});

export const getChannelHistory = action({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SlackChannelHistoryResult> => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    if (!args.channelId && !args.channelName) throw new Error("Provide channelId or channelName.");
    const token = requireSlackToken();
    const channels = await getFreshJoinedChannels({ ctx, token });
    const channel = findJoinedChannel({
      channels,
      channelId: args.channelId,
      channelName: args.channelName,
    });
    const result = await getSlackChannelHistory({
      token,
      channel,
      limit: args.limit,
    });
    return await enrichSlackChannelHistoryResult({ ctx, token, result });
  },
});

export const getThread = action({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    channelId: v.string(),
    threadTs: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SlackThreadResult> => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    const token = requireSlackToken();
    const result = await getSlackThread({
      token,
      channelId: args.channelId,
      threadTs: args.threadTs,
      limit: args.limit,
    });
    return await enrichSlackThreadResult({ ctx, token, result });
  },
});
