import type { Id } from "../../convex/_generated/dataModel";

// Max number of channel-history requests to run in parallel during a search.
const SEARCH_HISTORY_CONCURRENCY = 8;

export function requireSlackToken(): string {
  const token = process.env.SLACK_MCP_XOXB_TOKEN;
  if (!token) throw new Error("SLACK_MCP_XOXB_TOKEN is not set.");
  return token;
}

export function getSlackToken(): string | null {
  return process.env.SLACK_MCP_XOXB_TOKEN?.trim() || null;
}

type SlackApiResponse<T> = T & {
  ok: boolean;
  error?: string;
  response_metadata?: {
    next_cursor?: string;
  };
};

export type SlackChannel = {
  id: string;
  name?: string;
  is_member?: boolean;
  is_private?: boolean;
  num_members?: number;
};

type SlackChannelsList = {
  channels?: SlackChannel[];
};

export type SlackHistoryMessage = {
  type?: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  reply_count?: number;
};

type SlackConversationsHistory = {
  messages?: SlackHistoryMessage[];
  has_more?: boolean;
};

type SlackConversationsReplies = {
  messages?: SlackHistoryMessage[];
  has_more?: boolean;
};

type SlackUserProfile = {
  display_name?: string;
  display_name_normalized?: string;
  email?: string;
  image_72?: string;
};

type SlackUserInfo = {
  user?: {
    id?: string;
    name?: string;
    real_name?: string;
    is_bot?: boolean;
    deleted?: boolean;
    is_restricted?: boolean;
    is_ultra_restricted?: boolean;
    is_stranger?: boolean;
    profile?: SlackUserProfile;
  };
};

type SlackUsersList = {
  members?: Array<{
    id?: string;
    name?: string;
    real_name?: string;
    is_bot?: boolean;
    deleted?: boolean;
    is_restricted?: boolean;
    is_ultra_restricted?: boolean;
    is_stranger?: boolean;
    profile?: SlackUserProfile;
  }>;
};

type SlackBotInfo = {
  bot?: {
    id?: string;
    name?: string;
    user_id?: string;
  };
};

export type ResolvedSlackUser = {
  userId: string;
  username: string;
  email?: string;
  realName?: string;
  displayName?: string;
  avatarUrl?: string;
  isBot?: boolean;
  deleted?: boolean;
  isRestricted?: boolean;
  isUltraRestricted?: boolean;
  isStranger?: boolean;
};

export type SlackSearchMatch = {
  id: string;
  channelId: string;
  channelName?: string;
  channelIsPrivate?: boolean;
  threadTs: string;
  messageTs: string;
  userId?: string;
  botId?: string;
  authorName?: string;
  text: string;
  matchedTerms: string[];
  timestamp?: string;
};

export type SlackThreadMessage = {
  user?: string;
  username?: string;
  botId?: string;
  authorName?: string;
  ts?: string;
  text: string;
  timestamp?: string;
};

export type SlackThreadResult = {
  id: string;
  channelId: string;
  threadTs: string;
  messages: SlackThreadMessage[];
};

export type SlackChannelHistoryResult = {
  channelId: string;
  channelName?: string;
  messages: SlackThreadMessage[];
};

export type SlackSearchResult = {
  joinedChannelCount: number;
  searchedChannelCount: number;
  terms: string[];
  matches: SlackSearchMatch[];
};

type SlackFetchParams = {
  token: string;
  method: string;
  params?: Record<string, string | number | boolean | undefined>;
};

type SearchJoinedChannelsParams = {
  token: string;
  channels?: SlackChannel[];
  companyName?: string;
  domain?: string;
  query?: string;
  channelName?: string;
  channelLimit?: number;
  messagesPerChannel?: number;
  maxMatches?: number;
};

type GetSlackThreadParams = {
  token: string;
  channelId: string;
  threadTs: string;
  limit?: number;
};

type GetSlackChannelHistoryParams = {
  token: string;
  channel: SlackChannel;
  limit?: number;
};

type ResolveSlackUserParams = {
  token: string;
  userId: string;
};

function clamp({
  value,
  min,
  max,
}: {
  value: number | undefined;
  min: number;
  max: number;
}): number {
  return Math.max(min, Math.min(max, value ?? max));
}

export function slackTsToIso({ ts }: { ts?: string }): string | undefined {
  if (!ts) return undefined;
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}

// Replaces <@UXXX> user mention tokens with display names from the cache map.
// Call this BEFORE cleanSlackText so the angle-bracket stripping doesn't eat
// the user ID before we can resolve it. <@UXXX|displayname> forms are already
// handled by cleanSlackText's <url|label> rule.
export function resolveUserMentionsInText({
  text,
  userDisplayNames,
}: {
  text: string;
  userDisplayNames: Map<string, string>;
}): string {
  return text.replace(/<@(U[A-Z0-9]+)>/gi, (_match, userId: string) => {
    const name = userDisplayNames.get(userId);
    return name ? `@${name}` : "@[user]";
  });
}

export function cleanSlackText({ text }: { text?: string }): string {
  return (text ?? "")
    // <url|label> or <@UID|display> → keep the display part
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    // Slack special mentions
    .replace(/<!here>/gi, "@here")
    .replace(/<!channel>/gi, "@channel")
    .replace(/<!everyone>/gi, "@everyone")
    // <!subteam^S…> or <!subteam^S…|name> (second form already caught above)
    .replace(/<!subteam\^[A-Z0-9]+>/gi, "@[group]")
    // <@UXXX> user mentions without a display name — mask the raw ID
    .replace(/<@U[A-Z0-9]+>/gi, "@[user]")
    // strip any remaining <…> tokens
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function displayNameForSlackUser({
  userId,
  username,
  realName,
  displayName,
}: {
  userId: string;
  username?: string;
  realName?: string;
  displayName?: string;
}): string {
  return displayName || realName || username || userId;
}

export function buildSlackSearchTerms({
  companyName,
  domain,
  query,
}: {
  companyName?: string;
  domain?: string;
  query?: string;
}): string[] {
  const domainRoot = domain?.trim().replace(/^www\./i, "").split(".")[0];
  return [
    companyName,
    domain,
    domainRoot,
    query,
  ]
    .flatMap((value) => (value ?? "").split(/\s+OR\s+/i))
    .map((value) => value.trim().toLowerCase())
    .filter((value, index, values) => value.length >= 2 && values.indexOf(value) === index);
}

export type SlackWatchlistEntry = {
  companyId: Id<"companyProfiles">;
  domain: string;
  terms: string[];
};

// Terms that collide with Together AI's own internal usage. This Slack
// workspace *is* Together AI, so "together" shows up constantly in unrelated
// messages (the company's own name, "let's put this together", etc.), and
// "github" shows up constantly referring to Together's own GitHub org/repos
// rather than the company github.com. Both would otherwise dominate the daily
// mention scan with noise. Excluded regardless of which watchlisted company
// the term came from.
const EXCLUDED_WATCHLIST_TERMS = new Set(["together", "github"]);

// Slack channels that post automated/bot-generated content (model-benchmark
// reports, doc-drift alerts, etc.) where company names frequently collide
// with AI model names or generic terms. Excluded entirely from the daily
// mention scan (see convex/slackMentions.ts).
export const EXCLUDED_SLACK_MENTION_CHANNELS = new Set([
  "test-dr-inference",
  "devrel-automations",
  "devrel-team",
  // Support channel duplicates Pylon tickets already ingested via the Pylon pipeline.
  "inference-platform-support",
  // Automated Gong call-insight summaries — this data is already ingested via
  // the Gong pipeline and shown on the company's Activity tab, and the
  // channel's own "Call Insights from ..." post format makes companies whose
  // name/domain root is the word "insights" match almost every message.
  "gong-product-insights",
]);

// Builds the set of terms to match for a single watchlisted company (its
// name and domain root). Terms shorter than 5 characters are dropped — short
// domain roots/names (e.g. "code", "day", "fast", "one") collide with common
// English words and produce noisy false positives in the daily mention scan
// (see convex/slackMentions.ts); the full domain (e.g. "zoom.com") is usually
// long enough to survive this filter even when the bare name/root doesn't.
// Terms in EXCLUDED_WATCHLIST_TERMS (e.g. "together") are dropped entirely.
export function buildWatchlistEntry({
  companyId,
  domain,
  name,
}: {
  companyId: Id<"companyProfiles">;
  domain: string;
  name: string;
}): SlackWatchlistEntry {
  const terms = buildSlackSearchTerms({ companyName: name, domain })
    .filter((term) => term.length >= 5)
    .filter((term) => !EXCLUDED_WATCHLIST_TERMS.has(term));
  return { companyId, domain, terms };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type SlackWatchlistMatch = {
  companyId: Id<"companyProfiles">;
  domain: string;
  matchedTerms: string[];
};

// Matches a cleaned message text against every watchlist entry's terms,
// using word-boundary matching so e.g. "vast" doesn't match "devastate".
export function matchWatchlistEntries({
  text,
  entries,
}: {
  text: string;
  entries: SlackWatchlistEntry[];
}): SlackWatchlistMatch[] {
  const lower = text.toLowerCase();
  const matches: SlackWatchlistMatch[] = [];
  for (const entry of entries) {
    const matchedTerms = entry.terms.filter((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(lower));
    if (matchedTerms.length > 0) matches.push({ companyId: entry.companyId, domain: entry.domain, matchedTerms });
  }
  return matches;
}

export async function slackFetch<T>({
  token,
  method,
  params,
}: SlackFetchParams): Promise<SlackApiResponse<T>> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  return await response.json() as SlackApiResponse<T>;
}

// Slack errors that mean the principal genuinely does not exist. These are
// safe to cache as a fallback. Any other !ok response (ratelimited,
// internal_error, fatal_error, service_unavailable, …) is transient and must
// throw so the caller does not poison the cache with a raw-id placeholder.
const PERMANENT_SLACK_LOOKUP_ERRORS = new Set([
  "user_not_found",
  "bot_not_found",
  "users_not_found",
]);

function isTransientSlackLookupError({ error }: { error?: string }): boolean {
  return !error || !PERMANENT_SLACK_LOOKUP_ERRORS.has(error);
}

export async function resolveSlackUserFromApi({
  token,
  userId,
}: ResolveSlackUserParams): Promise<ResolvedSlackUser> {
  if (userId.startsWith("B")) {
    const result = await slackFetch<SlackBotInfo>({
      token,
      method: "bots.info",
      params: {
        bot: userId,
      },
    });
    if (!result.ok && isTransientSlackLookupError({ error: result.error })) {
      throw new Error(result.error ?? "Could not resolve Slack bot.");
    }
    const bot = result.bot;
    return {
      userId,
      username: bot?.name || userId,
      displayName: bot?.name,
      isBot: true,
    };
  }

  const result = await slackFetch<SlackUserInfo>({
    token,
    method: "users.info",
    params: {
      user: userId,
    },
  });
  if (!result.ok && isTransientSlackLookupError({ error: result.error })) {
    throw new Error(result.error ?? "Could not resolve Slack user.");
  }
  const user = result.user;
  const displayName = user?.profile?.display_name_normalized || user?.profile?.display_name;
  return {
    userId,
    username: displayNameForSlackUser({
      userId,
      username: user?.name,
      realName: user?.real_name,
      displayName,
    }),
    email: user?.profile?.email,
    realName: user?.real_name,
    displayName,
    avatarUrl: user?.profile?.image_72,
    isBot: user?.is_bot,
    deleted: user?.deleted,
    isRestricted: user?.is_restricted,
    isUltraRestricted: user?.is_ultra_restricted,
    isStranger: user?.is_stranger,
  };
}

export async function getSlackWorkspaceUsers({
  token,
  includeDeleted = false,
}: {
  token: string;
  includeDeleted?: boolean;
}): Promise<ResolvedSlackUser[]> {
  const users: ResolvedSlackUser[] = [];
  let cursor: string | undefined;

  do {
    const result = await slackFetch<SlackUsersList>({
      token,
      method: "users.list",
      params: {
        limit: 200,
        cursor,
      },
    });
    if (!result.ok) throw new Error(result.error ?? "Could not list Slack users.");

    for (const user of result.members ?? []) {
      if (!user.id) continue;
      if (!includeDeleted && user.deleted) continue;
      const displayName = user.profile?.display_name_normalized || user.profile?.display_name;
      users.push({
        userId: user.id,
        username: displayNameForSlackUser({
          userId: user.id,
          username: user.name,
          realName: user.real_name,
          displayName,
        }),
        email: user.profile?.email,
        realName: user.real_name,
        displayName,
        avatarUrl: user.profile?.image_72,
        isBot: user.is_bot,
        deleted: user.deleted,
        isRestricted: user.is_restricted,
        isUltraRestricted: user.is_ultra_restricted,
        isStranger: user.is_stranger,
      });
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return users;
}

export async function getJoinedSlackChannels({
  token,
  channelLimit,
}: {
  token: string;
  channelLimit?: number;
}): Promise<SlackChannel[]> {
  const maxChannels = clamp({ value: channelLimit, min: 1, max: 5000 });
  const joined: SlackChannel[] = [];
  let cursor: string | undefined;

  // Paginate until we have enough *joined* channels or run out of pages.
  // Counting joined (not raw) channels avoids exiting early on pages full of
  // non-member channels, which would silently truncate discovery.
  do {
    const result = await slackFetch<SlackChannelsList>({
      token,
      method: "conversations.list",
      params: {
        types: "public_channel,private_channel",
        limit: 200,
        cursor,
        exclude_archived: true,
      },
    });
    if (!result.ok) throw new Error(result.error ?? "Could not list Slack channels.");
    for (const channel of result.channels ?? []) {
      if (channel.is_member) joined.push(channel);
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor && joined.length < maxChannels);

  return joined.slice(0, maxChannels);
}

export async function searchJoinedSlackChannels({
  token,
  channels,
  companyName,
  domain,
  query,
  channelName,
  channelLimit,
  messagesPerChannel,
  maxMatches,
}: SearchJoinedChannelsParams): Promise<SlackSearchResult> {
  const terms = buildSlackSearchTerms({ companyName, domain, query });
  if (terms.length === 0) throw new Error("Provide a company name, domain, or query.");

  const joinedChannels = channels ?? await getJoinedSlackChannels({ token, channelLimit });
  const normalizedChannelName = channelName?.trim().replace(/^#/, "").toLowerCase();
  const channelsToSearch = normalizedChannelName
    ? joinedChannels.filter((channel) => channel.name?.toLowerCase().includes(normalizedChannelName))
    : joinedChannels;
  const perChannelLimit = clamp({ value: messagesPerChannel, min: 1, max: 200 });
  const matchLimit = clamp({ value: maxMatches, min: 1, max: 50 });
  const matches: SlackSearchMatch[] = [];

  // Fetch channel histories in bounded-concurrency batches rather than one at a
  // time, while still short-circuiting between batches once we hit matchLimit.
  for (let start = 0; start < channelsToSearch.length; start += SEARCH_HISTORY_CONCURRENCY) {
    if (matches.length >= matchLimit) break;
    const batch = channelsToSearch.slice(start, start + SEARCH_HISTORY_CONCURRENCY);
    const histories = await Promise.all(batch.map(async (channel) => {
      const history = await slackFetch<SlackConversationsHistory>({
        token,
        method: "conversations.history",
        params: {
          channel: channel.id,
          limit: perChannelLimit,
        },
      }).catch(() => null);
      return { channel, history };
    }));

    for (const { channel, history } of histories) {
      if (matches.length >= matchLimit) break;
      if (!history || !history.ok) continue;
      for (const message of history.messages ?? []) {
        const text = cleanSlackText({ text: message.text });
        if (!text) continue;
        const lower = text.toLowerCase();
        const matchedTerms = terms.filter((term) => lower.includes(term));
        if (matchedTerms.length === 0) continue;
        const messageTs = message.ts ?? "";
        const threadTs = message.thread_ts || messageTs;
        matches.push({
          id: `slack:${channel.id}:${threadTs}`,
          channelId: channel.id,
          channelName: channel.name,
          channelIsPrivate: channel.is_private,
          threadTs,
          messageTs,
          userId: message.user,
          botId: message.bot_id,
          authorName: message.username,
          text,
          matchedTerms,
          timestamp: slackTsToIso({ ts: messageTs }),
        });
        if (matches.length >= matchLimit) break;
      }
    }
  }

  return {
    joinedChannelCount: joinedChannels.length,
    searchedChannelCount: channelsToSearch.length,
    terms,
    matches: matches.sort((a, b) => (b.messageTs || "").localeCompare(a.messageTs || "")),
  };
}

export async function getSlackThread({
  token,
  channelId,
  threadTs,
  limit,
}: GetSlackThreadParams): Promise<SlackThreadResult> {
  const result = await slackFetch<SlackConversationsReplies>({
    token,
    method: "conversations.replies",
    params: {
      channel: channelId,
      ts: threadTs,
      limit: clamp({ value: limit, min: 1, max: 100 }),
    },
  });
  if (!result.ok) throw new Error(result.error ?? "Could not fetch Slack thread.");

  return {
    id: `slack:${channelId}:${threadTs}`,
    channelId,
    threadTs,
    messages: (result.messages ?? []).map((message) => ({
      user: message.user,
      username: message.username,
      botId: message.bot_id,
      authorName: message.username,
      ts: message.ts,
      text: cleanSlackText({ text: message.text }),
      timestamp: slackTsToIso({ ts: message.ts }),
    })),
  };
}

export async function getSlackChannelHistory({
  token,
  channel,
  limit,
}: GetSlackChannelHistoryParams): Promise<SlackChannelHistoryResult> {
  const result = await slackFetch<SlackConversationsHistory>({
    token,
    method: "conversations.history",
    params: {
      channel: channel.id,
      limit: clamp({ value: limit, min: 1, max: 100 }),
    },
  });
  if (!result.ok) throw new Error(result.error ?? "Could not fetch Slack channel history.");

  return {
    channelId: channel.id,
    channelName: channel.name,
    messages: (result.messages ?? []).map((message) => ({
      user: message.user,
      username: message.username,
      botId: message.bot_id,
      authorName: message.username,
      ts: message.ts,
      text: cleanSlackText({ text: message.text }),
      timestamp: slackTsToIso({ ts: message.ts }),
    })),
  };
}
