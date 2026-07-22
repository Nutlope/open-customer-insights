import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { requireAdmin, requireAuthenticated } from "../lib/convex/auth";
import { getJoinedSlackChannels, getSlackChannelHistory, type SlackChannel } from "../lib/convex/slack";
import {
  DEFAULT_COMPANY_SEGMENTS,
  LEGACY_DEFAULT_SEGMENT_SLUGS,
  PROVISIONED_THROUGHPUT_SEGMENT_SLUG,
  buildMembershipSummary,
  buildProspectClassificationPrompt,
  companyNameFromDomain,
  inferConfidence,
  inferFitScore,
  normalizeProspectDecision,
  normalizeDomain,
  parseProspectClassificationText,
  segmentInputSchema,
  type ProspectClassificationCandidate,
  type ProspectClassificationDecision,
} from "../lib/convex/prospects";
import { hasTogetherCredentials } from "../lib/integrations";

type SegmentInput = {
  title: string;
  description: string;
  status: "active" | "paused" | "archived";
  audience: "prospects" | "customers" | "both";
  detectionPrompt: string;
  searchQueries: string[];
  positiveSignals: string[];
  negativeSignals: string[];
  refreshCadence: "daily" | "weekly" | "manual";
};
type DbCtx = QueryCtx | MutationCtx;

type EvidenceRef = Doc<"companySegmentMemberships">["evidenceRefs"][number];
type ManualEvidenceRef = NonNullable<Doc<"companySegmentMemberships">["manualEvidenceRefs"]>[number];
type CompanyEvidence = {
  domain: string;
  name: string;
  sources: Doc<"companyProfiles">["sources"];
  evidenceRefs: EvidenceRef[];
  queryHits: Set<string>;
};
type QualifiedCompanyEvidence = {
  companyEvidence: CompanyEvidence;
  decision: ProspectClassificationDecision;
  evidenceRefs: EvidenceRef[];
};
type ClassificationResult = {
  // Candidates that are accepted with a high enough fit score to be
  // considered for inclusion in the segment.
  qualified: QualifiedCompanyEvidence[];
  // Every candidate that received a usable decision, keyed by domain,
  // regardless of accepted/fitScore. Used to refresh outcome fields for
  // already-tracked prospects even when they no longer qualify.
  decisionsByDomain: Map<string, QualifiedCompanyEvidence>;
};
type SegmentDashboard = Doc<"companySegments"> & {
  memberships: Array<Doc<"companySegmentMemberships"> & { company: ProspectCompany | null }>;
  latestRun: Doc<"companySegmentRuns"> | null;
};
type ProspectSlackChannel = {
  id: string;
  name: string;
};
type ProspectSlackMessageContext = {
  date?: string;
  author?: string;
  text: string;
};
type ProspectSlackChannelCache = {
  channelId: string;
  name?: string;
};
type ProspectCompany = Doc<"companyProfiles"> & {
  slackChannel?: ProspectSlackChannel | null;
};
type CompanyRecentActivityItem = {
  id: string;
  source: "call" | "support";
  title: string;
  date: string;
  companyDomain?: string;
};
type ProspectEvidenceOption = EvidenceRef & {
  alreadyPinned: boolean;
  // Slack-specific fields — only populated when source === "slack".
  // Used by the attach-evidence dialog to render SlackMentionCard and to
  // resolve mentionId for the pin mutation.
  slack?: {
    channelId: string;
    channelName?: string;
    messageTs: string;
    threadTs?: string;
    authorName?: string;
    authorAvatar?: string;
  };
};
type CompanySearchResult = {
  companyId?: Id<"companyProfiles">;
  name: string;
  domain: string;
  status: Doc<"companyProfiles">["status"];
  sources: Doc<"companyProfiles">["sources"];
  size?: string;
  callCount: number;
  ticketCount: number;
  alreadyProvisionedThroughputProspect: boolean;
};
type SourceDetailResult = {
  source: "call" | "support";
  title: string;
  companyDomain?: string;
  date?: string;
  people: Array<{ name?: string; email?: string }>;
  sections: Array<{ title: string; text: string }>;
  url?: string;
};

const togetherai = createOpenAICompatible({
  name: "togetherai",
  apiKey: process.env.TOGETHER_API_KEY,
  baseURL: "https://api.together.xyz/v1",
  supportsStructuredOutputs: true,
});

const PROSPECT_CLASSIFICATION_MODELS = [
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "deepseek-ai/DeepSeek-V4-Pro",
  "moonshotai/Kimi-K2.6",
] as const;
const PROSPECT_SEARCH_LIMIT_PER_QUERY = 50;
const PROSPECT_CANDIDATE_LIMIT = 15;
const PROSPECT_EVIDENCE_LIMIT = 4;
const PROSPECT_SOURCE_CONTEXT_CHARS = 2000;
const PROSPECT_CLASSIFICATION_BATCH_SIZE = 2;
const PROSPECT_SLACK_CONTEXT_LIMIT = 8;
const PROSPECT_SLACK_MESSAGE_LIMIT = 20;
const PROSPECT_SLACK_CONTEXT_CHARS = 1600;

const sourceRefValidator = v.object({
  source: v.union(v.literal("call"), v.literal("support"), v.literal("slack")),
  id: v.string(),
  title: v.optional(v.string()),
  date: v.optional(v.string()),
  snippet: v.string(),
});

const segmentInputValidator = {
  title: v.string(),
  description: v.string(),
  status: v.union(v.literal("active"), v.literal("paused"), v.literal("archived")),
  audience: v.union(v.literal("prospects"), v.literal("customers"), v.literal("both")),
  detectionPrompt: v.string(),
  searchQueries: v.array(v.string()),
  positiveSignals: v.array(v.string()),
  negativeSignals: v.array(v.string()),
  refreshCadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("manual")),
};

function slugify({ title }: { title: string }): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || `segment-${Date.now()}`;
}

function cleanList({ values }: { values: string[] }): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function parseSegmentInput({ input }: { input: SegmentInput }): SegmentInput {
  const parsed = segmentInputSchema.parse({
    ...input,
    searchQueries: cleanList({ values: input.searchQueries }),
    positiveSignals: cleanList({ values: input.positiveSignals }),
    negativeSignals: cleanList({ values: input.negativeSignals }),
  });
  return parsed;
}

function snippet({ text, maxLength = 360 }: { text: string; maxLength?: number }): string {
  const sliced = text.trim().replace(/\s+/g, " ").slice(0, maxLength);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  // Avoid leaving a lone high surrogate at the end if the slice split a surrogate pair.
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}

function sourceTime({ reference }: { reference: Pick<EvidenceRef, "date"> }): number {
  const time = reference.date ? new Date(reference.date).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function normalizeSlackChannelPart({ value }: { value: string }): string {
  const hostOrName = value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0] ?? "";
  return hostOrName
    .replace(/\.(ai|com|io|co|dev|app|net|org)$/i, "")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|company|co)\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function slackChannelCandidates({ company }: { company: { name: string; domain: string } }): Set<string> {
  const candidates = new Set<string>();
  for (const value of [company.name, company.domain]) {
    const normalized = normalizeSlackChannelPart({ value });
    if (normalized) candidates.add(`sales-${normalized}`);
  }
  return candidates;
}

function findProspectSlackChannel({
  company,
  channels,
}: {
  company: { name: string; domain: string };
  channels: ProspectSlackChannelCache[];
}): ProspectSlackChannel | null {
  const candidates = slackChannelCandidates({ company });
  const match = channels.find((channel) => channel.name ? candidates.has(channel.name.toLowerCase()) : false);
  if (!match?.name) return null;
  return { id: match.channelId, name: match.name };
}

async function getJoinedSlackChannelsForProspectRefresh({
  ctx,
  token,
}: {
  ctx: ActionCtx;
  token: string | null;
}): Promise<ProspectSlackChannelCache[]> {
  if (token) {
    try {
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
      return channels.map((channel) => ({
        channelId: channel.id,
        name: channel.name,
      }));
    } catch {
      // Fall back to the cache below.
    }
  }

  return await ctx.runQuery(internal.slack.getCachedJoinedChannels, {});
}

function requireSlackTokenForProspects(): string | null {
  return process.env.SLACK_MCP_XOXB_TOKEN ?? null;
}

function slackChannelFromProspectChannel({ channel }: { channel: ProspectSlackChannel }): SlackChannel {
  return {
    id: channel.id,
    name: channel.name,
    is_member: true,
  };
}

async function getProspectSlackContext({
  token,
  companyEvidence,
  channels,
}: {
  token: string | null;
  companyEvidence: Pick<CompanyEvidence, "name" | "domain">;
  channels: ProspectSlackChannelCache[];
}): Promise<{
  channel?: ProspectSlackChannel;
  messages: ProspectSlackMessageContext[];
}> {
  const channel = findProspectSlackChannel({
    company: companyEvidence,
    channels,
  });
  if (!token || !channel) return { channel: channel ?? undefined, messages: [] };

  try {
    const history = await getSlackChannelHistory({
      token,
      channel: slackChannelFromProspectChannel({ channel }),
      limit: PROSPECT_SLACK_MESSAGE_LIMIT,
    });
    return {
      channel,
      messages: history.messages
        .filter((message) => message.text.trim())
        .slice(0, PROSPECT_SLACK_CONTEXT_LIMIT)
        .map((message) => ({
          date: message.timestamp,
          author: message.authorName ?? message.username ?? message.user,
          text: snippet({ text: message.text, maxLength: PROSPECT_SLACK_CONTEXT_CHARS }),
        })),
    };
  } catch {
    return { channel, messages: [] };
  }
}

function evidenceFromManual({ references }: { references?: ManualEvidenceRef[] }): EvidenceRef[] {
  return (references ?? []).map((reference): EvidenceRef => ({
    source: reference.source,
    id: reference.id,
    title: reference.title,
    date: reference.date,
    snippet: reference.snippet,
  }));
}

function mergeEvidenceRefs({
  references,
  minimumLimit,
}: {
  references: EvidenceRef[];
  minimumLimit?: number;
}): EvidenceRef[] {
  const seen = new Set<string>();
  const unique = references.filter((reference) => {
    const key = `${reference.source}:${reference.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(reference.snippet.trim());
  });
  const limit = Math.max(PROSPECT_EVIDENCE_LIMIT, minimumLimit ?? 0);
  return unique
    .sort((a, b) => sourceTime({ reference: b }) - sourceTime({ reference: a }))
    .slice(0, limit);
}

function uniqueSources({
  existing,
  next,
}: {
  existing: Doc<"companyProfiles">["sources"];
  next: Doc<"companyProfiles">["sources"];
}): Doc<"companyProfiles">["sources"] {
  return [...new Set([...existing, ...next])];
}

async function chunkSnippet({
  ctx,
  source,
  id,
  fallback,
  maxLength = 1200,
}: {
  ctx: DbCtx;
  source: EvidenceRef["source"];
  id: string;
  fallback: string;
  maxLength?: number;
}): Promise<string> {
  const chunks = await ctx.db
    .query("chunks")
    .withIndex("by_source", (q) => q.eq("dataSource", source === "call" ? "gong" : "pylon").eq("sourceId", id))
    .take(3);
  return snippet({
    text: chunks.length > 0 ? chunks.map((chunk) => chunk.text).join(" ") : fallback,
    maxLength,
  });
}

async function resolveEvidenceRefForCompany({
  ctx,
  company,
  reference,
}: {
  ctx: DbCtx;
  company: Doc<"companyProfiles">;
  reference: EvidenceRef;
}): Promise<EvidenceRef> {
  if (reference.source === "call") {
    const call = await ctx.db
      .query("calls")
      .withIndex("by_gong_id", (q) => q.eq("gongId", reference.id))
      .unique();
    if (!call || call.companyDomain !== company.domain) {
      throw new Error("That call is not attached to this company.");
    }
    return {
      source: "call",
      id: call.gongId,
      title: call.title,
      date: call.started,
      snippet: snippet({
        text: [
          ...(call.keyPoints ?? []),
          call.brief,
          reference.snippet,
        ].filter(Boolean).join(" "),
        maxLength: 1200,
      }),
    };
  }

  const ticket = await ctx.db
    .query("pylonIssues")
    .withIndex("by_pylon_id", (q) => q.eq("pylonId", reference.id))
    .unique();
  if (!ticket || ticket.companyDomain !== company.domain) {
    throw new Error("That ticket is not attached to this company.");
  }
  return {
    source: "support",
    id: ticket.pylonId,
    title: `#${ticket.number} ${ticket.title}`,
    date: ticket.createdAt,
    snippet: await chunkSnippet({
      ctx,
      source: "support",
      id: ticket.pylonId,
      fallback: [
        ticket.title,
        ticket.issueCategory,
        ticket.priority ? `Priority: ${ticket.priority}` : null,
        ticket.state,
        reference.snippet,
      ].filter(Boolean).join(" | "),
    }),
  };
}

async function getSegmentBySlug({
  ctx,
  slug,
}: {
  ctx: QueryCtx;
  slug: string;
}): Promise<Doc<"companySegments"> | null> {
  return await ctx.db
    .query("companySegments")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

export const listSegments = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<"companySegments">[]> => {
    await requireAuthenticated({ ctx });
    const segments = await ctx.db.query("companySegments").collect();
    return segments
      .filter((segment) => args.includeArchived || segment.status !== "archived")
      .sort((a, b) => a.title.localeCompare(b.title));
  },
});

export const listCompanies = query({
  args: {
    status: v.optional(v.union(
      v.literal("customer"),
      v.literal("prospect"),
      v.literal("former_customer"),
      v.literal("unknown"),
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"companyProfiles">[]> => {
    await requireAuthenticated({ ctx });
    const companies = args.status
      ? await ctx.db
          .query("companyProfiles")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .take(args.limit ?? 100)
      : await ctx.db.query("companyProfiles").take(args.limit ?? 100);
    return companies.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const searchCompanyProfiles = query({
  args: {
    search: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CompanySearchResult[]> => {
    await requireAdmin({ ctx });
    const search = args.search.trim();
    const limit = args.limit ?? 8;
    if (!search) {
      return [];
    }

    const searchMatches = await ctx.db
      .query("companyProfiles")
      .withSearchIndex("by_name", (q) => q.search("name", search))
      .take(limit);
    const normalizedSearch = search.toLowerCase();
    const domainMatches = await ctx.db
      .query("companyProfiles")
      .take(1000);
    const companyByDomain = new Map<string, Doc<"companyProfiles">>();
    for (const company of searchMatches) companyByDomain.set(company.domain, company);
    for (const company of domainMatches) {
      if (
        company.domain.toLowerCase().includes(normalizedSearch) ||
        company.name.toLowerCase().includes(normalizedSearch)
      ) {
        companyByDomain.set(company.domain, company);
      }
    }
    const activityByDomain = new Map<string, {
      name: string;
      sources: Doc<"companyProfiles">["sources"];
      callCount: number;
      ticketCount: number;
    }>();
    const recentCalls = await ctx.db.query("calls").order("desc").take(1000);
    for (const call of recentCalls) {
      const domain = normalizeDomain({ value: call.companyDomain });
      if (!domain || !(domain.includes(normalizedSearch) || companyNameFromDomain({ domain }).toLowerCase().includes(normalizedSearch))) continue;
      const existing = activityByDomain.get(domain);
      if (existing) {
        existing.callCount++;
        existing.sources = uniqueSources({ existing: existing.sources, next: ["gong"] });
      } else {
        activityByDomain.set(domain, {
          name: companyByDomain.get(domain)?.name ?? companyNameFromDomain({ domain }),
          sources: ["gong"],
          callCount: 1,
          ticketCount: 0,
        });
      }
    }
    const recentTickets = await ctx.db.query("pylonIssues").order("desc").take(1000);
    for (const ticket of recentTickets) {
      const domain = normalizeDomain({ value: ticket.companyDomain });
      const name = ticket.companyName?.trim() || (domain ? companyNameFromDomain({ domain }) : "");
      if (!domain || !(domain.includes(normalizedSearch) || name.toLowerCase().includes(normalizedSearch))) continue;
      const existing = activityByDomain.get(domain);
      if (existing) {
        existing.ticketCount++;
        existing.sources = uniqueSources({ existing: existing.sources, next: ["pylon"] });
        if (!existing.name.trim()) existing.name = name;
      } else {
        activityByDomain.set(domain, {
          name: companyByDomain.get(domain)?.name ?? name,
          sources: ["pylon"],
          callCount: 0,
          ticketCount: 1,
        });
      }
    }
    const provisionedThroughputSegment = await getSegmentBySlug({
      ctx,
      slug: PROVISIONED_THROUGHPUT_SEGMENT_SLUG,
    });
    const trackedCompanyIds = new Set<Id<"companyProfiles">>();
    if (provisionedThroughputSegment) {
      const memberships = await ctx.db
        .query("companySegmentMemberships")
        .withIndex("by_segment", (q) => q.eq("segmentId", provisionedThroughputSegment._id))
        .collect();
      for (const membership of memberships) {
        trackedCompanyIds.add(membership.companyId);
      }
    }
    const candidates = [...activityByDomain.entries()].map(([domain, activity]) => {
      const company = companyByDomain.get(domain);
      return {
        companyId: company?._id,
        name: company?.name ?? activity.name,
        domain,
        status: company?.status ?? "unknown",
        sources: uniqueSources({ existing: company?.sources ?? [], next: activity.sources }),
        callCount: activity.callCount,
        ticketCount: activity.ticketCount,
        alreadyProvisionedThroughputProspect: company ? trackedCompanyIds.has(company._id) : false,
      };
    });
    return candidates
      .sort((a, b) => {
        const aExact = a.domain.toLowerCase() === normalizedSearch || a.name.toLowerCase() === normalizedSearch;
        const bExact = b.domain.toLowerCase() === normalizedSearch || b.name.toLowerCase() === normalizedSearch;
        if (aExact !== bExact) return aExact ? -1 : 1;
        const activityDelta = (b.callCount + b.ticketCount) - (a.callCount + a.ticketCount);
        if (activityDelta !== 0) return activityDelta;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  },
});

export const getCompanyRecentActivity = query({
  args: {
    companyId: v.id("companyProfiles"),
    limit: v.optional(v.number()),
    // When true, fetches the full call and ticket history without capping per type.
    // Use for the full timeline view; leave false for recent-activity sidebars.
    fullHistory: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CompanyRecentActivityItem[]> => {
    await requireAuthenticated({ ctx });
    const company = await ctx.db.get(args.companyId);
    if (!company || company.domain.endsWith(".unknown")) return [];

    const limit = args.limit ?? 6;
    const domains = [company.domain, ...(company.domainAliases ?? [])];

    const [callArrays, ticketArrays] = args.fullHistory
      ? await Promise.all([
          Promise.all(
            domains.map((d) =>
              ctx.db
                .query("calls")
                .withIndex("by_company_started", (q) => q.eq("companyDomain", d))
                .order("desc")
                .collect()
            )
          ),
          Promise.all(
            domains.map((d) =>
              ctx.db
                .query("pylonIssues")
                .withIndex("by_company_created", (q) => q.eq("companyDomain", d))
                .order("desc")
                .collect()
            )
          ),
        ])
      : await Promise.all([
          Promise.all(
            domains.map((d) =>
              ctx.db
                .query("calls")
                .withIndex("by_company_started", (q) => q.eq("companyDomain", d))
                .order("desc")
                .take(limit)
            )
          ),
          Promise.all(
            domains.map((d) =>
              ctx.db
                .query("pylonIssues")
                .withIndex("by_company_created", (q) => q.eq("companyDomain", d))
                .order("desc")
                .take(limit)
            )
          ),
        ]);

    const all = [
      ...callArrays.flat().map((call): CompanyRecentActivityItem => ({
        id: call.gongId,
        source: "call",
        title: call.title,
        date: call.started,
        companyDomain: call.companyDomain,
      })),
      ...ticketArrays.flat().map((ticket): CompanyRecentActivityItem => ({
        id: ticket.pylonId,
        source: "support",
        title: ticket.title,
        date: ticket.createdAt,
        companyDomain: ticket.companyDomain,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return args.fullHistory ? all : all.slice(0, limit);
  },
});


export const getCompanyKeyEvidence = query({
  args: { companyId: v.id("companyProfiles") },
  handler: async (ctx, { companyId }): Promise<Array<{
    id: string;
    source: "call" | "support" | "slack";
    title: string;
    date: string;
    companyDomain?: string;
    pinned: boolean;
  }>> => {
    await requireAuthenticated({ ctx });
    const memberships = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();

    const seen = new Set<string>();
    const refs: Array<{ source: "call" | "support" | "slack"; id: string; pinned: boolean }> = [];
    for (const m of memberships) {
      const pinnedKeys = new Set((m.manualEvidenceRefs ?? []).map((r) => `${r.source}:${r.id}`));
      // manually pinned first
      for (const ref of m.manualEvidenceRefs ?? []) {
        const key = `${ref.source}:${ref.id}`;
        if (!seen.has(key)) { seen.add(key); refs.push({ source: ref.source, id: ref.id, pinned: true }); }
      }
      // AI evidence refs
      for (const ref of m.evidenceRefs) {
        const key = `${ref.source}:${ref.id}`;
        if (!seen.has(key)) { seen.add(key); refs.push({ source: ref.source, id: ref.id, pinned: pinnedKeys.has(key) }); }
      }
    }

    const items = await Promise.all(
      refs.map(async ({ source, id, pinned }) => {
        if (source === "call") {
          const call = await ctx.db.query("calls").withIndex("by_gong_id", (q) => q.eq("gongId", id)).first();
          if (!call) return null;
          return { id: call.gongId, source: "call" as const, title: call.title, date: call.started, companyDomain: call.companyDomain, pinned };
        }
        if (source === "support") {
          const ticket = await ctx.db.query("pylonIssues").withIndex("by_pylon_id", (q) => q.eq("pylonId", id)).first();
          if (!ticket) return null;
          return { id: ticket.pylonId, source: "support" as const, title: ticket.title, date: ticket.createdAt, companyDomain: ticket.companyDomain, pinned };
        }
        const mention = await ctx.db.get(id as Id<"slackCompanyMentions">);
        if (!mention) return null;
        return {
          id: mention._id,
          source: "slack" as const,
          title: `${mention.authorName ?? "Unknown"} in #${mention.channelName ?? mention.channelId}`,
          date: mention.postedAt,
          companyDomain: mention.domain,
          pinned,
        };
      })
    );

    return items
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.date.localeCompare(a.date);
      });
  },
});

export const getCompanyPinnedActivity = query({
  args: { companyId: v.id("companyProfiles") },
  handler: async (ctx, { companyId }): Promise<Array<{
    id: string;
    source: "call" | "support" | "slack";
    title: string;
    date: string;
    companyDomain?: string;
    // Slack-specific fields — only populated when source === "slack". The page
    // uses these to render SlackMentionCard for pinned Slack mentions even
    // when they're outside the recent-N window returned by getCompanySlackMentions.
    slackText?: string;
    slackChannelName?: string;
    slackAuthorName?: string;
    slackAuthorAvatar?: string;
  }>> => {
    await requireAuthenticated({ ctx });
    const memberships = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();

    const seen = new Set<string>();
    const refs: Array<{ source: "call" | "support" | "slack"; id: string }> = [];
    for (const m of memberships) {
      for (const ref of m.manualEvidenceRefs ?? []) {
        const key = `${ref.source}:${ref.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push({ source: ref.source, id: ref.id });
        }
      }
    }

    const items = await Promise.all(
      refs.map(async ({ source, id }) => {
        if (source === "call") {
          const call = await ctx.db
            .query("calls")
            .withIndex("by_gong_id", (q) => q.eq("gongId", id))
            .first();
          if (!call) return null;
          return { id: call.gongId, source: "call" as const, title: call.title, date: call.started, companyDomain: call.companyDomain };
        }
        if (source === "support") {
          const ticket = await ctx.db
            .query("pylonIssues")
            .withIndex("by_pylon_id", (q) => q.eq("pylonId", id))
            .first();
          if (!ticket) return null;
          return { id: ticket.pylonId, source: "support" as const, title: ticket.title, date: ticket.createdAt, companyDomain: ticket.companyDomain };
        }
        const mention = await ctx.db.get(id as Id<"slackCompanyMentions">);
        if (!mention) return null;
        return {
          id: mention._id,
          source: "slack" as const,
          title: `${mention.authorName ?? "Unknown"} in #${mention.channelName ?? mention.channelId}`,
          date: mention.postedAt,
          companyDomain: mention.domain,
          slackText: mention.text,
          slackChannelName: mention.channelName,
          slackAuthorName: mention.authorName,
        };
      })
    );

    return items.filter((item): item is NonNullable<typeof item> => item !== null);
  },
});

export const getProspectEvidenceOptions = query({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ProspectEvidenceOption[]> => {
    await requireAuthenticated({ ctx });
    const company = await ctx.db.get(args.companyId);
    if (!company || company.domain.endsWith(".unknown")) return [];
    const limit = args.limit ?? 20;
    const sourceLimit = Math.max(limit * 3, 60);
    const membership = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
      .unique();
    const pinned = new Set((membership?.manualEvidenceRefs ?? []).map((reference) => `${reference.source}:${reference.id}`));
    const timeline = new Set((membership?.evidenceRefs ?? []).map((reference) => `${reference.source}:${reference.id}`));
    const [calls, tickets, mentions] = await Promise.all([
      ctx.db
        .query("calls")
        .withIndex("by_company_started", (q) => q.eq("companyDomain", company.domain))
        .order("desc")
        .take(sourceLimit),
      ctx.db
        .query("pylonIssues")
        .withIndex("by_company_created", (q) => q.eq("companyDomain", company.domain))
        .order("desc")
        .take(sourceLimit),
      ctx.db
        .query("slackCompanyMentions")
        .withIndex("by_company_posted", (q) => q.eq("companyId", args.companyId))
        .order("desc")
        .take(sourceLimit),
    ]);

    const options: ProspectEvidenceOption[] = [];
    for (const call of calls) {
      const evidence: EvidenceRef = {
        source: "call",
        id: call.gongId,
        title: call.title,
        date: call.started,
        snippet: snippet({
          text: [
            ...(call.keyPoints ?? []),
            call.brief,
          ].filter(Boolean).join(" "),
          maxLength: 1200,
        }),
      };
      options.push({
        ...evidence,
        alreadyPinned: pinned.has(`${evidence.source}:${evidence.id}`),
      });
    }
    for (const ticket of tickets) {
      const evidence: EvidenceRef = {
        source: "support",
        id: ticket.pylonId,
        title: `#${ticket.number} ${ticket.title}`,
        date: ticket.createdAt,
        snippet: await chunkSnippet({
          ctx,
          source: "support",
          id: ticket.pylonId,
          fallback: [
            ticket.title,
            ticket.issueCategory,
            ticket.priority ? `Priority: ${ticket.priority}` : null,
            ticket.state,
          ].filter(Boolean).join(" | "),
          maxLength: 1200,
        }),
      };
      options.push({
        ...evidence,
        alreadyPinned: pinned.has(`${evidence.source}:${evidence.id}`),
      });
    }
    for (const mention of mentions) {
      let avatarUrl: string | undefined;
      if (mention.authorUserId) {
        const user = await ctx.db
          .query("slackUserCache")
          .withIndex("by_user", (q) => q.eq("userId", mention.authorUserId!))
          .unique();
        if (user) avatarUrl = user.avatarUrl;
      }
      options.push({
        source: "slack",
        id: mention._id,
        title: `${mention.authorName ?? "Unknown"} in #${mention.channelName ?? mention.channelId}`,
        date: mention.postedAt,
        snippet: snippet({ text: mention.text, maxLength: 360 }),
        alreadyPinned: pinned.has(`slack:${mention._id}`),
        slack: {
          channelId: mention.channelId,
          channelName: mention.channelName,
          messageTs: mention.messageTs,
          threadTs: mention.threadTs,
          authorName: mention.authorName,
          authorAvatar: avatarUrl,
        },
      });
    }

    const normalizedSearch = (args.search ?? "").trim().toLowerCase();
    return options
      .filter((option) => !option.alreadyPinned)
      .filter((option) => {
        if (!normalizedSearch) return true;
        return [
          option.title,
          option.snippet,
          option.source,
          option.slack?.channelName,
          option.slack?.authorName,
        ].some((value) => (value ?? "").toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => sourceTime({ reference: b }) - sourceTime({ reference: a }))
      .slice(0, limit);
  },
});

export const getProspectDashboard = query({
  args: {
    segmentSlug: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SegmentDashboard[]> => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    const rawSegments = args.segmentSlug
      ? await getSegmentBySlug({ ctx, slug: args.segmentSlug }).then((segment) => segment ? [segment] : [])
      : await ctx.db
          .query("companySegments")
          .withIndex("by_status", (q) => q.eq("status", "active"))
          .collect();
    const joinedSlackChannels = await ctx.db
      .query("slackChannelCache")
      .withIndex("by_joined", (q) => q.eq("isJoined", true))
      .collect();
    const dashboards: SegmentDashboard[] = [];
    for (const segment of rawSegments.sort((a, b) => a.title.localeCompare(b.title))) {
      const memberships = await ctx.db
        .query("companySegmentMemberships")
        .withIndex("by_segment", (q) => q.eq("segmentId", segment._id))
        .collect();
      const hydrated = [];
      for (const membership of memberships.sort((a, b) => b.fitScore - a.fitScore || b.lastSeenAt - a.lastSeenAt)) {
        const company = await ctx.db.get(membership.companyId);
        hydrated.push({
          ...membership,
          company: company ? {
            ...company,
            slackChannel: findProspectSlackChannel({
              company,
              channels: joinedSlackChannels,
            }),
          } : null,
        });
      }
      const latestRun = await ctx.db
        .query("companySegmentRuns")
        .withIndex("by_segment", (q) => q.eq("segmentId", segment._id))
        .order("desc")
        .first();
      dashboards.push({ ...segment, memberships: hydrated, latestRun });
    }
    return dashboards;
  },
});

export const getProspectDomains = query({
  args: {},
  handler: async (ctx): Promise<Array<{ domain: string; companyId: Id<"companyProfiles"> }>> => {
    await requireAuthenticated({ ctx });
    const segment = await getSegmentBySlug({
      ctx,
      slug: PROVISIONED_THROUGHPUT_SEGMENT_SLUG,
    });
    if (!segment) return [];
    const memberships = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment", (q) => q.eq("segmentId", segment._id))
      .collect();
    const result: Array<{ domain: string; companyId: Id<"companyProfiles"> }> = [];
    for (const membership of memberships) {
      const company = await ctx.db.get(membership.companyId);
      if (company) result.push({ domain: company.domain, companyId: company._id });
    }
    return result;
  },
});

export const seedDefaultSegments = mutation({
  args: {},
  handler: async (ctx): Promise<{ inserted: number; updated: number; archived: number }> => {
    await requireAdmin({ ctx });
    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    for (const seed of DEFAULT_COMPANY_SEGMENTS) {
      const existing = await getSegmentBySlug({ ctx, slug: seed.slug });
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...seed,
          status: existing.status,
          updatedAt: now,
          updatedByEmail: identity?.email,
        });
        updated++;
      } else {
        await ctx.db.insert("companySegments", {
          ...seed,
          status: "active",
          createdAt: now,
          updatedAt: now,
          createdByEmail: identity?.email,
          updatedByEmail: identity?.email,
        });
        inserted++;
      }
    }
    let archived = 0;
    for (const slug of LEGACY_DEFAULT_SEGMENT_SLUGS) {
      const legacy = await getSegmentBySlug({ ctx, slug });
      if (legacy && legacy.status !== "archived") {
        await ctx.db.patch(legacy._id, {
          status: "archived",
          updatedAt: now,
          updatedByEmail: identity?.email,
        });
        archived++;
      }
    }
    return { inserted, updated, archived };
  },
});

export const addManualProvisionedThroughputProspect = mutation({
  args: {
    companyId: v.optional(v.id("companyProfiles")),
    name: v.string(),
    domain: v.string(),
  },
  handler: async (ctx, args): Promise<{ companyId: Id<"companyProfiles">; membershipCreated: boolean; refreshScheduled: boolean }> => {
    const adminEmail = await requireAdmin({ ctx });
    const now = Date.now();
    const cleanedName = args.name.trim();
    const domain = normalizeDomain({ value: args.domain });
    if (!cleanedName) throw new Error("Company name is required.");
    if (!domain) throw new Error("Company domain is required.");

    const segment = await getSegmentBySlug({
      ctx,
      slug: PROVISIONED_THROUGHPUT_SEGMENT_SLUG,
    });
    if (!segment) throw new Error("Provisioned throughput segment does not exist yet.");

    const [callHit, ticketHit] = await Promise.all([
      ctx.db
        .query("calls")
        .withIndex("by_company_started", (q) => q.eq("companyDomain", domain))
        .first(),
      ctx.db
        .query("pylonIssues")
        .withIndex("by_company_created", (q) => q.eq("companyDomain", domain))
        .first(),
    ]);
    if (!callHit && !ticketHit) {
      throw new Error("Only companies with existing calls or tickets can be added as prospects.");
    }
    const sources = uniqueSources({
      existing: [],
      next: [
        ...(callHit ? ["gong" as const] : []),
        ...(ticketHit ? ["pylon" as const] : []),
      ],
    });
    const companyFromId = args.companyId ? await ctx.db.get(args.companyId) : null;
    const existingByDomain = await ctx.db
      .query("companyProfiles")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();
    const company = companyFromId ?? existingByDomain;
    const staleManualDescription = company?.description === "Manually added PT prospect; needs source-backed discovery.";
    const companyId = company?._id ?? await ctx.db.insert("companyProfiles", {
      domain,
      name: cleanedName,
      status: "prospect",
      sources,
      description: "-",
      createdAt: now,
      updatedAt: now,
    });
    if (company) {
      await ctx.db.patch(company._id, {
        name: company.name || cleanedName,
        domain: company.domain || domain,
        status: company.status === "unknown" ? "prospect" : company.status,
        sources: uniqueSources({ existing: company.sources, next: sources }),
        description: !company.description || staleManualDescription ? "-" : company.description,
        updatedAt: now,
      });
    }
    const dismissed = await ctx.db
      .query("dismissedCompanySegments")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", segment._id).eq("companyId", companyId))
      .unique();
    if (dismissed) {
      await ctx.db.delete(dismissed._id);
    }

    const existingMembership = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", segment._id).eq("companyId", companyId))
      .unique();
    if (existingMembership) {
      if (existingMembership.evidenceRefs.length === 0) {
        await ctx.db.patch(existingMembership._id, {
          fitScore: 0,
          confidence: "low",
          stage: "Researching",
          summary: "-",
          currentState: "-",
          blockers: [],
          nextSteps: [],
          origin: existingMembership.origin ?? "manual",
          addedByEmail: existingMembership.addedByEmail ?? adminEmail,
          addedAt: existingMembership.addedAt ?? now,
          updatedAt: now,
        });
      }
      await ctx.scheduler.runAfter(0, internal.prospects.refreshSegmentInternal, { segmentId: segment._id });
      return { companyId, membershipCreated: false, refreshScheduled: true };
    }

    await ctx.db.insert("companySegmentMemberships", {
      companyId,
      segmentId: segment._id,
      fitScore: 0,
      confidence: "low",
      stage: "Researching",
      summary: "-",
      currentState: "-",
      blockers: [],
      nextSteps: [],
      evidenceRefs: [],
      origin: "manual",
      addedByEmail: adminEmail,
      addedAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.prospects.refreshSegmentInternal, { segmentId: segment._id });
    return { companyId, membershipCreated: true, refreshScheduled: true };
  },
});

export const pinProspectEvidence = mutation({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
    reference: sourceRefValidator,
  },
  handler: async (ctx, args): Promise<{ pinned: boolean }> => {
    const adminEmail = await requireAdmin({ ctx });
    const [company, membership] = await Promise.all([
      ctx.db.get(args.companyId),
      ctx.db
        .query("companySegmentMemberships")
        .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
        .unique(),
    ]);
    if (!company) throw new Error("Company not found.");
    if (!membership) throw new Error("This company is not tracked in that segment.");

    const canonical = await resolveEvidenceRefForCompany({
      ctx,
      company,
      reference: args.reference,
    });
    const key = `${canonical.source}:${canonical.id}`;
    const now = Date.now();
    const manualEvidenceRefs = membership.manualEvidenceRefs ?? [];
    const alreadyPinned = manualEvidenceRefs.some((reference) => `${reference.source}:${reference.id}` === key);
    const nextManualEvidenceRefs: ManualEvidenceRef[] = alreadyPinned
      ? manualEvidenceRefs
      : [
          ...manualEvidenceRefs,
          {
            ...canonical,
            addedByEmail: adminEmail,
            addedAt: now,
          },
        ];
    await ctx.db.patch(membership._id, {
      manualEvidenceRefs: nextManualEvidenceRefs,
      evidenceRefs: mergeEvidenceRefs({
        references: [
          canonical,
          ...membership.evidenceRefs,
        ],
        minimumLimit: nextManualEvidenceRefs.length,
      }),
      lastSeenAt: Math.max(membership.lastSeenAt, sourceTime({ reference: canonical }) || now),
      updatedAt: now,
    });
    return { pinned: !alreadyPinned };
  },
});

export const unpinProspectEvidence = mutation({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
    source: v.union(v.literal("call"), v.literal("support")),
    id: v.string(),
  },
  handler: async (ctx, args): Promise<{ unpinned: boolean }> => {
    await requireAdmin({ ctx });
    const membership = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
      .unique();
    if (!membership) throw new Error("This company is not tracked in that segment.");
    const key = `${args.source}:${args.id}`;
    const manualEvidenceRefs = membership.manualEvidenceRefs ?? [];
    const nextManualEvidenceRefs = manualEvidenceRefs.filter((reference) => `${reference.source}:${reference.id}` !== key);
    if (nextManualEvidenceRefs.length === manualEvidenceRefs.length) {
      return { unpinned: false };
    }
    await ctx.db.patch(membership._id, {
      manualEvidenceRefs: nextManualEvidenceRefs,
      updatedAt: Date.now(),
    });
    return { unpinned: true };
  },
});

export const pinProspectSlackEvidence = mutation({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
    mentionId: v.id("slackCompanyMentions"),
  },
  handler: async (ctx, args): Promise<{ pinned: boolean }> => {
    const adminEmail = await requireAdmin({ ctx });
    const [company, membership, mention] = await Promise.all([
      ctx.db.get(args.companyId),
      ctx.db
        .query("companySegmentMemberships")
        .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
        .unique(),
      ctx.db.get(args.mentionId),
    ]);
    if (!company) throw new Error("Company not found.");
    if (!membership) throw new Error("This company is not tracked in that segment.");
    if (!mention) throw new Error("Slack mention not found.");
    if (mention.companyId !== args.companyId) {
      throw new Error("That Slack mention is not attached to this company.");
    }

    const key = `slack:${args.mentionId}`;
    const now = Date.now();
    const slackRef: ManualEvidenceRef = {
      source: "slack",
      id: args.mentionId,
      title: `${mention.authorName ?? "Unknown"} in #${mention.channelName ?? mention.channelId}`,
      date: mention.postedAt,
      snippet: snippet({ text: mention.text, maxLength: 360 }),
      slack: {
        channelId: mention.channelId,
        channelName: mention.channelName,
        messageTs: mention.messageTs,
        threadTs: mention.threadTs,
        authorName: mention.authorName,
      },
      addedByEmail: adminEmail,
      addedAt: now,
    };

    const manualEvidenceRefs = membership.manualEvidenceRefs ?? [];
    const alreadyPinned = manualEvidenceRefs.some((reference) => `${reference.source}:${reference.id}` === key);
    const nextManualEvidenceRefs: ManualEvidenceRef[] = alreadyPinned
      ? manualEvidenceRefs
      : [...manualEvidenceRefs, slackRef];

    // evidenceRefs is a narrower shape than manualEvidenceRefs (no slack /
    // addedAt / addedByEmail), so strip those before merging.
    const slackEvidenceRef: EvidenceRef = {
      source: "slack",
      id: args.mentionId,
      title: slackRef.title,
      date: slackRef.date,
      snippet: slackRef.snippet,
    };
    const nextEvidenceRefs = mergeEvidenceRefs({
      references: [slackEvidenceRef, ...membership.evidenceRefs],
      minimumLimit: nextManualEvidenceRefs.length,
    });

    await ctx.db.patch(membership._id, {
      manualEvidenceRefs: nextManualEvidenceRefs,
      evidenceRefs: nextEvidenceRefs,
      lastSeenAt: Math.max(membership.lastSeenAt, new Date(mention.postedAt).getTime() || now),
      updatedAt: now,
    });
    return { pinned: !alreadyPinned };
  },
});

export const unpinProspectSlackEvidence = mutation({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
    mentionId: v.id("slackCompanyMentions"),
  },
  handler: async (ctx, args): Promise<{ unpinned: boolean }> => {
    await requireAdmin({ ctx });
    const membership = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
      .unique();
    if (!membership) throw new Error("This company is not tracked in that segment.");
    const key = `slack:${args.mentionId}`;
    const manualEvidenceRefs = membership.manualEvidenceRefs ?? [];
    const nextManualEvidenceRefs = manualEvidenceRefs.filter((reference) => `${reference.source}:${reference.id}` !== key);
    if (nextManualEvidenceRefs.length === manualEvidenceRefs.length) {
      return { unpinned: false };
    }
    const nextEvidenceRefs = membership.evidenceRefs.filter((reference) => `${reference.source}:${reference.id}` !== key);
    await ctx.db.patch(membership._id, {
      manualEvidenceRefs: nextManualEvidenceRefs,
      evidenceRefs: nextEvidenceRefs,
      updatedAt: Date.now(),
    });
    return { unpinned: true };
  },
});

export const setProspectOutcome = mutation({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
    outcome: v.union(v.literal("active"), v.literal("lost"), v.literal("won"), v.literal("stalled")),
    lostToCompetitor: v.optional(v.string()),
    lostReason: v.optional(v.string()),
    competitorsConsidered: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ updated: boolean }> => {
    const adminEmail = await requireAdmin({ ctx });
    const membership = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
      .unique();
    if (!membership) throw new Error("This company is not tracked in that segment.");

    const competitorsConsidered = [...new Set((args.competitorsConsidered ?? []).map((competitor) => competitor.trim()).filter(Boolean))];
    await ctx.db.patch(membership._id, {
      outcome: args.outcome,
      lostToCompetitor: args.outcome === "lost" ? (args.lostToCompetitor?.trim() || undefined) : undefined,
      lostReason: args.outcome === "lost" ? (args.lostReason?.trim() || undefined) : undefined,
      competitorsConsidered: competitorsConsidered.length > 0 ? competitorsConsidered : undefined,
      outcomeOrigin: "manual",
      outcomeSetByEmail: adminEmail,
      outcomeSetAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

export const clearProspectOutcomeOverride = mutation({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
  },
  handler: async (ctx, args): Promise<{ cleared: boolean }> => {
    await requireAdmin({ ctx });
    const membership = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
      .unique();
    if (!membership) throw new Error("This company is not tracked in that segment.");
    await ctx.db.patch(membership._id, {
      outcomeOrigin: "ai",
      outcomeSetByEmail: undefined,
      outcomeSetAt: undefined,
      updatedAt: Date.now(),
    });
    return { cleared: true };
  },
});

export const removeProvisionedThroughputProspect = mutation({
  args: {
    companyId: v.id("companyProfiles"),
  },
  handler: async (ctx, args): Promise<{ removed: boolean }> => {
    const adminEmail = await requireAdmin({ ctx });
    const segment = await getSegmentBySlug({
      ctx,
      slug: PROVISIONED_THROUGHPUT_SEGMENT_SLUG,
    });
    if (!segment) throw new Error("Provisioned throughput segment does not exist yet.");
    const company = await ctx.db.get(args.companyId);
    if (!company) throw new Error("Company not found.");

    const membership = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", segment._id).eq("companyId", args.companyId))
      .unique();
    const dismissed = await ctx.db
      .query("dismissedCompanySegments")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", segment._id).eq("companyId", args.companyId))
      .unique();
    if (!dismissed) {
      await ctx.db.insert("dismissedCompanySegments", {
        segmentId: segment._id,
        companyId: args.companyId,
        domain: company.domain,
        dismissedByEmail: adminEmail,
        dismissedAt: Date.now(),
        reason: "Removed from prospects page",
      });
    }
    if (!membership) return { removed: false };
    await ctx.db.delete(membership._id);
    return { removed: true };
  },
});

export const upsertSegment = mutation({
  args: {
    segmentId: v.optional(v.id("companySegments")),
    ...segmentInputValidator,
  },
  handler: async (ctx, args): Promise<Id<"companySegments">> => {
    await requireAdmin({ ctx });
    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();
    const input = parseSegmentInput({ input: args });
    if (args.segmentId) {
      await ctx.db.patch(args.segmentId, {
        ...input,
        updatedAt: now,
        updatedByEmail: identity?.email,
      });
      return args.segmentId;
    }

    const baseSlug = slugify({ title: input.title });
    let slug = baseSlug;
    let suffix = 2;
    while (await getSegmentBySlug({ ctx, slug })) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    return await ctx.db.insert("companySegments", {
      slug,
      ...input,
      createdAt: now,
      updatedAt: now,
      createdByEmail: identity?.email,
      updatedByEmail: identity?.email,
    });
  },
});

export const getSegmentsForRefresh = internalQuery({
  args: {
    segmentId: v.optional(v.id("companySegments")),
    cadence: v.optional(v.union(v.literal("daily"), v.literal("weekly"), v.literal("manual"))),
  },
  handler: async (ctx, args): Promise<Doc<"companySegments">[]> => {
    if (args.segmentId) {
      const segment = await ctx.db.get(args.segmentId);
      return segment ? [segment] : [];
    }
    const segments = await ctx.db
      .query("companySegments")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return segments.filter((segment) => !args.cadence || segment.refreshCadence === args.cadence);
  },
});

export const getExistingMembershipsForSegment = internalQuery({
  args: {
    segmentId: v.id("companySegments"),
  },
  handler: async (ctx, args): Promise<Array<Doc<"companySegmentMemberships"> & { company: Doc<"companyProfiles"> }>> => {
    const memberships = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId))
      .collect();
    const result: Array<Doc<"companySegmentMemberships"> & { company: Doc<"companyProfiles"> }> = [];
    for (const membership of memberships) {
      const company = await ctx.db.get(membership.companyId);
      if (!company || company.domain.endsWith(".unknown")) continue;
      result.push({ ...membership, company });
    }
    return result;
  },
});

export const getMembershipForCompany = internalQuery({
  args: {
    segmentId: v.id("companySegments"),
    companyId: v.id("companyProfiles"),
  },
  handler: async (ctx, args): Promise<(Doc<"companySegmentMemberships"> & { company: Doc<"companyProfiles"> }) | null> => {
    const membership = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
      .unique();
    if (!membership) return null;
    const company = await ctx.db.get(args.companyId);
    if (!company) return null;
    return { ...membership, company };
  },
});

export const getDismissedDomainsForSegment = internalQuery({
  args: {
    segmentId: v.id("companySegments"),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const dismissed = await ctx.db
      .query("dismissedCompanySegments")
      .withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId))
      .collect();
    return dismissed.map((item) => item.domain);
  },
});

export const getRecentEvidenceForCompanies = internalQuery({
  args: {
    domains: v.array(v.string()),
    limitPerCompany: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Array<{ domain: string; evidenceRefs: EvidenceRef[]; sources: Doc<"companyProfiles">["sources"] }>> => {
    const limit = args.limitPerCompany ?? PROSPECT_EVIDENCE_LIMIT;
    const results: Array<{ domain: string; evidenceRefs: EvidenceRef[]; sources: Doc<"companyProfiles">["sources"] }> = [];
    for (const rawDomain of args.domains) {
      const domain = normalizeDomain({ value: rawDomain });
      if (!domain) continue;
      const [calls, tickets] = await Promise.all([
        ctx.db
          .query("calls")
          .withIndex("by_company_started", (q) => q.eq("companyDomain", domain))
          .order("desc")
          .take(limit),
        ctx.db
          .query("pylonIssues")
          .withIndex("by_company_created", (q) => q.eq("companyDomain", domain))
          .order("desc")
          .take(limit),
      ]);
      const evidenceRefs: EvidenceRef[] = [
        ...calls.map((call): EvidenceRef => ({
          source: "call",
          id: call.gongId,
          title: call.title,
          date: call.started,
          snippet: snippet({
            text: [
              ...(call.keyPoints ?? []),
              call.brief,
            ].filter(Boolean).join(" "),
            maxLength: 1200,
          }),
        })),
        ...tickets.map((ticket): EvidenceRef => ({
          source: "support",
          id: ticket.pylonId,
          title: `#${ticket.number} ${ticket.title}`,
          date: ticket.createdAt,
          snippet: snippet({
            text: [
              ticket.title,
              ticket.issueCategory,
              ticket.priority ? `Priority: ${ticket.priority}` : null,
              ticket.state,
            ].filter(Boolean).join(" | "),
          }),
        })),
      ]
        .filter((ref) => ref.snippet)
        .sort((a, b) => sourceTime({ reference: b }) - sourceTime({ reference: a }))
        .slice(0, limit);
      results.push({
        domain,
        evidenceRefs,
        sources: uniqueSources({
          existing: [],
          next: [
            ...(calls.length > 0 ? ["gong" as const] : []),
            ...(tickets.length > 0 ? ["pylon" as const] : []),
          ],
        }),
      });
    }
    return results;
  },
});

export const upsertCompanyProfile = internalMutation({
  args: {
    domain: v.string(),
    name: v.string(),
    status: v.union(
      v.literal("customer"),
      v.literal("prospect"),
      v.literal("former_customer"),
      v.literal("unknown"),
    ),
    sources: v.array(v.union(
      v.literal("gong"),
      v.literal("pylon"),
      v.literal("web"),
      v.literal("slack"),
      v.literal("clay"),
    )),
  },
  handler: async (ctx, args): Promise<{ companyId: Id<"companyProfiles">; created: boolean }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("companyProfiles")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: existing.name || args.name,
        status: existing.status === "unknown" ? args.status : existing.status,
        sources: uniqueSources({ existing: existing.sources, next: args.sources }),
        updatedAt: now,
      });
      return { companyId: existing._id, created: false };
    }
    const companyId = await ctx.db.insert("companyProfiles", {
      domain: args.domain,
      name: args.name,
      status: args.status,
      sources: args.sources,
      createdAt: now,
      updatedAt: now,
    });
    return { companyId, created: true };
  },
});

export const upsertMembership = internalMutation({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
    fitScore: v.number(),
    confidence: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    stage: v.string(),
    summary: v.string(),
    currentState: v.optional(v.string()),
    scale: v.optional(v.string()),
    extraDetails: v.optional(v.array(v.string())),
    blockers: v.array(v.string()),
    nextSteps: v.array(v.string()),
    evidenceRefs: v.array(sourceRefValidator),
    origin: v.optional(v.union(v.literal("ai"), v.literal("manual"))),
    lastSeenAt: v.number(),
    outcome: v.optional(v.union(v.literal("active"), v.literal("lost"), v.literal("won"), v.literal("stalled"))),
    lostToCompetitor: v.optional(v.string()),
    lostReason: v.optional(v.string()),
    competitorsConsidered: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ created: boolean }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment_company", (q) => q.eq("segmentId", args.segmentId).eq("companyId", args.companyId))
      .unique();
    if (existing) {
      const existingOrigin = existing.origin ?? (existing.stage === "Researching" && existing.evidenceRefs.length === 0 ? "manual" : args.origin ?? "ai");
      const outcomeIsManual = existing.outcomeOrigin === "manual";
      await ctx.db.patch(existing._id, {
        fitScore: args.fitScore,
        confidence: args.confidence,
        stage: args.stage,
        summary: args.summary,
        currentState: args.currentState,
        scale: args.scale,
        extraDetails: args.extraDetails,
        blockers: args.blockers,
        nextSteps: args.nextSteps,
        evidenceRefs: args.evidenceRefs,
        origin: existingOrigin,
        addedAt: existing.addedAt ?? (existingOrigin === "manual" ? existing.firstSeenAt : undefined),
        lastSeenAt: Math.max(existing.lastSeenAt, args.lastSeenAt),
        outcome: outcomeIsManual ? existing.outcome : (args.outcome ?? "active"),
        lostToCompetitor: outcomeIsManual ? existing.lostToCompetitor : args.lostToCompetitor,
        lostReason: outcomeIsManual ? existing.lostReason : args.lostReason,
        competitorsConsidered: outcomeIsManual ? existing.competitorsConsidered : args.competitorsConsidered,
        outcomeOrigin: outcomeIsManual ? existing.outcomeOrigin : "ai",
        updatedAt: now,
      });
      return { created: false };
    }
    await ctx.db.insert("companySegmentMemberships", {
      ...args,
      origin: args.origin ?? "ai",
      outcome: args.outcome ?? "active",
      outcomeOrigin: "ai",
      firstSeenAt: now,
      updatedAt: now,
    });
    return { created: true };
  },
});

export const clearSegmentMemberships = internalMutation({
  args: {
    segmentId: v.id("companySegments"),
    preserveCompanyIds: v.optional(v.array(v.id("companyProfiles"))),
  },
  handler: async (ctx, args): Promise<number> => {
    const preserveCompanyIds = new Set(args.preserveCompanyIds ?? []);
    const existing = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_segment", (q) => q.eq("segmentId", args.segmentId))
      .collect();
    for (const membership of existing) {
      if (preserveCompanyIds.has(membership.companyId)) continue;
      if (membership.origin === "manual") continue;
      if (membership.stage === "Researching" && membership.evidenceRefs.length === 0) continue;
      await ctx.db.delete(membership._id);
    }
    return existing.length;
  },
});

export const insertSegmentRun = internalMutation({
  args: {
    segmentId: v.id("companySegments"),
    summary: v.string(),
    newCompanies: v.number(),
    updatedCompanies: v.number(),
    evidenceCount: v.number(),
    startedAt: v.number(),
    completedAt: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"companySegmentRuns">> => {
    return await ctx.db.insert("companySegmentRuns", args);
  },
});

async function collectEvidenceForSegment({
  ctx,
  segment,
}: {
  ctx: ActionCtx;
  segment: Doc<"companySegments">;
}): Promise<Map<string, CompanyEvidence>> {
  const grouped = new Map<string, CompanyEvidence>();
  const chunkByKey = new Map<string, Doc<"chunks">>();
  const queryTexts = [...new Set([
    segment.detectionPrompt.trim(),
    ...segment.searchQueries.map((query) => query.trim()),
  ].filter(Boolean))];
  for (const queryText of queryTexts) {
    const chunks = await ctx.runQuery(internal.search.searchChunksByText, {
      query: queryText,
      limit: PROSPECT_SEARCH_LIMIT_PER_QUERY,
    }) as Doc<"chunks">[];
    for (const chunk of chunks) {
      chunkByKey.set(`${chunk.dataSource}:${chunk.sourceId}:${chunk.chunkId}`, chunk);
    }
  }

  const chunks = [...chunkByKey.values()];
  const gongIds = [...new Set(chunks.filter((chunk) => chunk.dataSource === "gong").map((chunk) => chunk.sourceId))];
  const pylonIds = [...new Set(chunks.filter((chunk) => chunk.dataSource === "pylon").map((chunk) => chunk.sourceId))];
  const [calls, issues] = await Promise.all([
    gongIds.length ? ctx.runQuery(internal.search.getCallsByGongIds, { gongIds }) : Promise.resolve([]),
    pylonIds.length ? ctx.runQuery(internal.search.getPylonIssuesByIds, { pylonIds }) : Promise.resolve([]),
  ]);
  const callMap = new Map(
    (calls as Array<Doc<"calls"> | null>).filter((call): call is Doc<"calls"> => call !== null).map((call) => [call.gongId, call]),
  );
  const issueMap = new Map(
    (issues as Array<Doc<"pylonIssues"> | null>).filter((issue): issue is Doc<"pylonIssues"> => issue !== null).map((issue) => [issue.pylonId, issue]),
  );

  for (const chunk of chunks) {
    const call = chunk.dataSource === "gong" ? callMap.get(chunk.sourceId) : undefined;
    const issue = chunk.dataSource === "pylon" ? issueMap.get(chunk.sourceId) : undefined;
    const rawDomain = normalizeDomain({ value: chunk.companyDomain ?? call?.companyDomain ?? issue?.companyDomain });
    if (!rawDomain) continue;
    const domain = rawDomain;
    const name = issue?.companyName?.trim() || companyNameFromDomain({ domain });

    const source = chunk.dataSource === "gong" ? "gong" : "pylon";
    const evidenceRef: EvidenceRef = {
      source: chunk.dataSource === "gong" ? "call" : "support",
      id: chunk.sourceId,
      title: call?.title ?? (issue ? `#${issue.number} ${issue.title}` : undefined),
      date: call?.started ?? issue?.createdAt,
      snippet: snippet({ text: chunk.text }),
    };
    const existing = grouped.get(domain);
    if (existing) {
      existing.sources = uniqueSources({ existing: existing.sources, next: [source] });
      if (!existing.evidenceRefs.some((ref) => ref.source === evidenceRef.source && ref.id === evidenceRef.id && ref.snippet === evidenceRef.snippet)) {
        existing.evidenceRefs.push(evidenceRef);
        existing.evidenceRefs.sort((a, b) => sourceTime({ reference: b }) - sourceTime({ reference: a }));
        existing.evidenceRefs = existing.evidenceRefs.slice(0, PROSPECT_EVIDENCE_LIMIT);
      }
      existing.queryHits.add(chunk.text);
    } else {
      grouped.set(domain, {
        domain,
        name,
        sources: [source],
        evidenceRefs: [evidenceRef],
        queryHits: new Set([chunk.text]),
      });
    }
  }

  return grouped;
}

async function buildClassificationCandidates({
  ctx,
  grouped,
  trackedDomains,
}: {
  ctx: ActionCtx;
  grouped: Map<string, CompanyEvidence>;
  trackedDomains: Set<string>;
}): Promise<ProspectClassificationCandidate[]> {
  const allRefs = [...grouped.values()].flatMap((companyEvidence) => companyEvidence.evidenceRefs);
  const callIds = [...new Set(allRefs.filter((ref) => ref.source === "call").map((ref) => ref.id))];
  const supportIds = [...new Set(allRefs.filter((ref) => ref.source === "support").map((ref) => ref.id))];
  const [callContent, supportContent] = await Promise.all([
    callIds.length
      ? ctx.runQuery(internal.search.getSourceContentByIds, {
          dataSource: "gong",
          sourceIds: callIds,
        }) as Promise<Array<{ sourceId: string; text: string }>>
      : Promise.resolve([]),
    supportIds.length
      ? ctx.runQuery(internal.search.getSourceContentByIds, {
          dataSource: "pylon",
          sourceIds: supportIds,
        }) as Promise<Array<{ sourceId: string; text: string }>>
      : Promise.resolve([]),
  ]);
  const sourceContext = new Map<string, string>([
    ...callContent.map((item) => [`call:${item.sourceId}`, item.text] as const),
    ...supportContent.map((item) => [`support:${item.sourceId}`, item.text] as const),
  ]);

  const byRecency = (a: CompanyEvidence, b: CompanyEvidence): number => {
    const recencyDelta = Math.max(...b.evidenceRefs.map((ref) => sourceTime({ reference: ref }))) - Math.max(...a.evidenceRefs.map((ref) => sourceTime({ reference: ref })));
    if (recencyDelta !== 0) return recencyDelta;
    return b.evidenceRefs.length - a.evidenceRefs.length || a.name.localeCompare(b.name);
  };
  const all = [...grouped.values()].sort(byRecency);
  const pinned = all.filter((e) => trackedDomains.has(e.domain));
  const fresh = all.filter((e) => !trackedDomains.has(e.domain)).slice(0, PROSPECT_CANDIDATE_LIMIT);
  const combined = [...pinned, ...fresh].sort(byRecency);
  const slackToken = requireSlackTokenForProspects();
  const joinedSlackChannels = await getJoinedSlackChannelsForProspectRefresh({
    ctx,
    token: slackToken,
  });
  const slackContexts = new Map<string, {
    channel?: ProspectSlackChannel;
    messages: ProspectSlackMessageContext[];
  }>();
  for (const companyEvidence of combined) {
    slackContexts.set(companyEvidence.domain, await getProspectSlackContext({
      token: slackToken,
      companyEvidence,
      channels: joinedSlackChannels,
    }));
  }

  const toCandidate = (companyEvidence: CompanyEvidence): ProspectClassificationCandidate => ({
    ...(() => {
      const slackContext = slackContexts.get(companyEvidence.domain);
      return {
        domain: companyEvidence.domain,
        name: companyEvidence.name,
        slackChannel: slackContext?.channel,
        slackMessages: slackContext?.messages,
        evidence: companyEvidence.evidenceRefs
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
          .slice(0, PROSPECT_EVIDENCE_LIMIT)
          .map((ref, index) => ({
            index,
            source: ref.source,
            title: ref.title,
            date: ref.date,
            snippet: [
              ref.snippet,
              sourceContext.get(`${ref.source}:${ref.id}`),
            ].filter(Boolean).join("\n\nSource detail:\n").slice(0, PROSPECT_SOURCE_CONTEXT_CHARS),
          })),
      };
    })(),
  });
  return combined.map(toCandidate);
}

async function generateClassificationDecisionBatch({
  segment,
  candidates,
}: {
  segment: Doc<"companySegments">;
  candidates: ProspectClassificationCandidate[];
}): Promise<ProspectClassificationDecision[]> {
  if (candidates.length === 0) return [];
  const prompt = `${buildProspectClassificationPrompt({ segment, candidates })}

Return only JSON matching this shape:
{
  "decisions": [
    {
      "domain": "candidate domain",
      "accepted": true,
      "fitScore": 0,
      "confidence": "low",
      "stage": "short stage",
      "summary": "source-grounded summary",
      "currentState": "source-grounded current state or null",
      "scale": "best concrete GPU/token/request/spend scale or null",
      "extraDetails": ["additional core fact not repeated elsewhere"],
      "blockers": [],
      "nextSteps": [],
      "evidenceIndexes": [0],
      "rejectionReason": null,
      "outcome": "active",
      "lostToCompetitor": null,
      "lostReason": null,
      "competitorsConsidered": []
    }
  ]
}`;
  let lastError: Error | null = null;
  for (const model of PROSPECT_CLASSIFICATION_MODELS) {
    try {
      const { text } = await generateText({
        model: togetherai(model),
        temperature: 0,
        maxOutputTokens: 6000,
        prompt,
      });
      return parseProspectClassificationText({ text }).decisions;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("Prospect classification failed");
}

async function generateClassificationDecisions({
  segment,
  candidates,
}: {
  segment: Doc<"companySegments">;
  candidates: ProspectClassificationCandidate[];
}): Promise<ProspectClassificationDecision[]> {
  const decisions: ProspectClassificationDecision[] = [];
  for (let index = 0; index < candidates.length; index += PROSPECT_CLASSIFICATION_BATCH_SIZE) {
    const batch = candidates.slice(index, index + PROSPECT_CLASSIFICATION_BATCH_SIZE);
    try {
      decisions.push(...await generateClassificationDecisionBatch({ segment, candidates: batch }));
    } catch (error) {
      if (batch.length === 1) throw error;
      for (const candidate of batch) {
        try {
          decisions.push(...await generateClassificationDecisionBatch({ segment, candidates: [candidate] }));
        } catch {
          continue;
        }
      }
    }
  }
  return decisions;
}

function findDecisionForCandidate({
  candidate,
  decisions,
}: {
  candidate: ProspectClassificationCandidate;
  decisions: ProspectClassificationDecision[];
}): ProspectClassificationDecision | undefined {
  const decisionsByKey = new Map<string, ProspectClassificationDecision>();
  for (const decision of decisions) {
    decisionsByKey.set((normalizeDomain({ value: decision.domain }) ?? decision.domain).toLowerCase(), decision);
    decisionsByKey.set(decision.domain.trim().toLowerCase(), decision);
  }
  return decisionsByKey.get(candidate.domain.toLowerCase()) ?? decisionsByKey.get(candidate.name.toLowerCase());
}

function selectEvidenceRefsForDecision({
  companyEvidence,
  candidate,
  decision,
}: {
  companyEvidence: CompanyEvidence;
  candidate: ProspectClassificationCandidate;
  decision: ProspectClassificationDecision;
}): EvidenceRef[] {
  const selectedIndexes = decision.evidenceIndexes.length > 0
    ? decision.evidenceIndexes
    : candidate.evidence.slice(0, 3).map((item) => item.index);
  const sortedEvidenceRefs = companyEvidence.evidenceRefs
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 8);
  const seenEvidence = new Set<string>();
  return selectedIndexes
    .map((index): EvidenceRef | null => {
      const ref = sortedEvidenceRefs[index];
      const candidateEvidence = candidate.evidence[index];
      if (!ref) return null;
      return {
        ...ref,
        snippet: snippet({ text: candidateEvidence?.snippet ?? ref.snippet }),
      };
    })
    .filter((ref): ref is EvidenceRef => ref !== null)
    .filter((ref) => {
      const key = `${ref.source}:${ref.id}`;
      if (seenEvidence.has(key)) return false;
      seenEvidence.add(key);
      return true;
    })
    .slice(0, 8);
}

function qualifyClassificationDecisions({
  grouped,
  candidates,
  decisions,
}: {
  grouped: Map<string, CompanyEvidence>;
  candidates: ProspectClassificationCandidate[];
  decisions: ProspectClassificationDecision[];
}): ClassificationResult {
  const qualified: QualifiedCompanyEvidence[] = [];
  const decisionsByDomain = new Map<string, QualifiedCompanyEvidence>();
  for (const candidate of candidates) {
    const companyEvidence = grouped.get(candidate.domain);
    const rawDecision = findDecisionForCandidate({ candidate, decisions });
    if (!companyEvidence || !rawDecision) continue;
    const decision = normalizeProspectDecision({
      decision: rawDecision,
      evidenceCount: candidate.evidence.length,
    });
    const evidenceRefs = selectEvidenceRefsForDecision({ companyEvidence, candidate, decision });
    if (evidenceRefs.length === 0) continue;
    const entry: QualifiedCompanyEvidence = { companyEvidence, decision, evidenceRefs };
    // Record every decision (not just accepted/high-fit ones) so already-tracked
    // prospects still get their outcome/lostToCompetitor/etc. fields refreshed
    // even when the prospect no longer "qualifies" as a fresh segment candidate
    // (e.g. they decided to go with a competitor instead of Together).
    decisionsByDomain.set(candidate.domain, entry);
    if (decision.accepted && decision.fitScore >= 80) {
      qualified.push(entry);
    }
  }
  return {
    qualified: qualified.sort((a, b) => b.decision.fitScore - a.decision.fitScore),
    decisionsByDomain,
  };
}

async function classifyCompanyEvidence({
  ctx,
  segment,
  grouped,
  trackedDomains,
}: {
  ctx: ActionCtx;
  segment: Doc<"companySegments">;
  grouped: Map<string, CompanyEvidence>;
  trackedDomains: Set<string>;
}): Promise<ClassificationResult> {
  const candidates = await buildClassificationCandidates({ ctx, grouped, trackedDomains });
  const decisions = await generateClassificationDecisions({ segment, candidates });
  return qualifyClassificationDecisions({ grouped, candidates, decisions });
}

async function refreshSingleProspectMembership({
  ctx,
  segment,
  membership,
}: {
  ctx: ActionCtx;
  segment: Doc<"companySegments">;
  membership: Doc<"companySegmentMemberships"> & { company: Doc<"companyProfiles"> };
}): Promise<{ accepted: boolean; fitScore: number; stage: string }> {
  const company = membership.company;
  const [recent] = await ctx.runQuery(internal.prospects.getRecentEvidenceForCompanies, {
    domains: [company.domain],
    limitPerCompany: PROSPECT_EVIDENCE_LIMIT,
  });
  const manualEvidenceRefs = evidenceFromManual({ references: membership.manualEvidenceRefs });
  const evidenceRefs = mergeEvidenceRefs({
    references: [
      ...manualEvidenceRefs,
      ...(recent?.evidenceRefs ?? []),
      ...membership.evidenceRefs,
    ],
    minimumLimit: manualEvidenceRefs.length,
  });
  const companyEvidence: CompanyEvidence = {
    domain: company.domain,
    name: company.name,
    sources: uniqueSources({ existing: company.sources, next: recent?.sources ?? [] }),
    evidenceRefs,
    queryHits: new Set(),
  };
  if (companyEvidence.evidenceRefs.length === 0) {
    throw new Error("No evidence available to classify this prospect.");
  }
  const grouped = new Map<string, CompanyEvidence>([[company.domain, companyEvidence]]);
  const candidates = await buildClassificationCandidates({
    ctx,
    grouped,
    trackedDomains: new Set([company.domain]),
  });
  const candidate = candidates.find((item) => item.domain === company.domain);
  if (!candidate || candidate.evidence.length === 0) {
    throw new Error("No evidence available to classify this prospect.");
  }
  const decisions = await generateClassificationDecisions({ segment, candidates: [candidate] });
  const rawDecision = findDecisionForCandidate({ candidate, decisions });
  if (!rawDecision) {
    throw new Error("Classifier did not return a decision for this prospect.");
  }
  const decision = normalizeProspectDecision({ decision: rawDecision, evidenceCount: candidate.evidence.length });
  const selectedEvidenceRefs = selectEvidenceRefsForDecision({ companyEvidence, candidate, decision });
  const evidenceRefsToSave = (selectedEvidenceRefs.length > 0 ? selectedEvidenceRefs : companyEvidence.evidenceRefs)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const lastSeenAt = evidenceRefsToSave.reduce((max, ref) => {
    const time = ref.date ? new Date(ref.date).getTime() : 0;
    return Number.isFinite(time) ? Math.max(max, time) : max;
  }, 0) || Date.now();
  await ctx.runMutation(internal.prospects.upsertMembership, {
    companyId: membership.companyId,
    segmentId: segment._id,
    fitScore: decision.fitScore,
    confidence: decision.confidence,
    stage: decision.stage,
    summary: decision.summary || buildMembershipSummary({ segment, companyName: company.name, evidence: evidenceRefsToSave }),
    currentState: decision.currentState ?? evidenceRefsToSave[0]?.snippet,
    scale: decision.scale ?? undefined,
    extraDetails: decision.extraDetails ?? undefined,
    blockers: decision.blockers,
    nextSteps: decision.nextSteps.length > 0
      ? decision.nextSteps
      : ["Review source evidence", "Confirm account owner and current evaluation status"],
    evidenceRefs: evidenceRefsToSave,
    origin: membership.origin ?? "ai",
    lastSeenAt,
    outcome: decision.outcome ?? undefined,
    lostToCompetitor: decision.lostToCompetitor ?? undefined,
    lostReason: decision.lostReason ?? undefined,
    competitorsConsidered: decision.competitorsConsidered ?? undefined,
  });
  return { accepted: decision.accepted, fitScore: decision.fitScore, stage: decision.stage };
}

async function refreshSegments({
  ctx,
  segmentId,
  cadence,
}: {
  ctx: ActionCtx;
  segmentId?: Id<"companySegments">;
  cadence?: "daily" | "weekly" | "manual";
}): Promise<{ segments: number; newCompanies: number; updatedCompanies: number; evidenceCount: number }> {
  const startedAt = Date.now();
  const segments = await ctx.runQuery(internal.prospects.getSegmentsForRefresh, { segmentId, cadence });
  let totalNewCompanies = 0;
  let totalUpdatedCompanies = 0;
  let totalEvidenceCount = 0;
  for (const segment of segments) {
    if (segment.status !== "active") continue;
    const grouped = await collectEvidenceForSegment({ ctx, segment });
    const dismissedDomains = new Set(await ctx.runQuery(
      internal.prospects.getDismissedDomainsForSegment,
      { segmentId: segment._id },
    ));
    for (const domain of dismissedDomains) {
      grouped.delete(domain);
    }

    const existingMemberships = await ctx.runQuery(
      internal.prospects.getExistingMembershipsForSegment,
      { segmentId: segment._id },
    );
    const recentEvidence = await ctx.runQuery(
      internal.prospects.getRecentEvidenceForCompanies,
      {
        domains: existingMemberships.map((membership) => membership.company.domain),
        limitPerCompany: PROSPECT_EVIDENCE_LIMIT,
      },
    );
    const recentByDomain = new Map(recentEvidence.map((item) => [item.domain, item]));
    const trackedDomains = new Set(existingMemberships.map((m) => m.company.domain));
    for (const membership of existingMemberships) {
      const domain = membership.company.domain;
      if (dismissedDomains.has(domain)) continue;
      const recent = recentByDomain.get(domain);
      const manualEvidenceRefs = evidenceFromManual({ references: membership.manualEvidenceRefs });
      const evidenceRefs = mergeEvidenceRefs({
        references: [
          ...manualEvidenceRefs,
          ...(recent?.evidenceRefs ?? []),
          ...membership.evidenceRefs,
        ],
        minimumLimit: manualEvidenceRefs.length,
      });
      const existing = grouped.get(domain);
      if (existing) {
        existing.sources = uniqueSources({ existing: existing.sources, next: recent?.sources ?? membership.company.sources });
        for (const reference of evidenceRefs) {
          if (existing.evidenceRefs.some((item) => item.source === reference.source && item.id === reference.id)) continue;
          existing.evidenceRefs.push(reference);
        }
        existing.evidenceRefs.sort((a, b) => sourceTime({ reference: b }) - sourceTime({ reference: a }));
        existing.evidenceRefs = existing.evidenceRefs.slice(0, PROSPECT_EVIDENCE_LIMIT);
        continue;
      }
      grouped.set(domain, {
        domain,
        name: membership.company.name,
        sources: uniqueSources({ existing: membership.company.sources, next: recent?.sources ?? [] }),
        evidenceRefs,
        queryHits: new Set(),
      });
    }

    let qualified: QualifiedCompanyEvidence[];
    let decisionsByDomain: Map<string, QualifiedCompanyEvidence>;
    try {
      ({ qualified, decisionsByDomain } = await classifyCompanyEvidence({ ctx, segment, grouped, trackedDomains }));
    } catch (error) {
      await ctx.runMutation(internal.prospects.insertSegmentRun, {
        segmentId: segment._id,
        summary: `${segment.title} refresh failed during classification: ${error instanceof Error ? error.message : "Unknown error"}. Existing memberships were preserved.`,
        newCompanies: 0,
        updatedCompanies: 0,
        evidenceCount: 0,
        startedAt,
        completedAt: Date.now(),
      });
      continue;
    }
    await ctx.runMutation(internal.prospects.clearSegmentMemberships, {
      segmentId: segment._id,
      preserveCompanyIds: existingMemberships.map((membership) => membership.companyId),
    });
    let newCompanies = 0;
    let updatedCompanies = 0;
    let evidenceCount = 0;
    // Refresh every already-tracked prospect that received a decision, even if
    // the decision is no longer "qualified" (e.g. accepted=false because they
    // went with a competitor). Otherwise outcome/lostToCompetitor/etc. never
    // get written for prospects that fall out of the segment's fit criteria.
    for (const domain of trackedDomains) {
      const qualifiedCompany = decisionsByDomain.get(domain);
      if (!qualifiedCompany) continue;
      const { companyEvidence, decision } = qualifiedCompany;
      const evidenceRefs = qualifiedCompany.evidenceRefs
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      try {
        const { companyId, created } = await ctx.runMutation(internal.prospects.upsertCompanyProfile, {
          domain: companyEvidence.domain,
          name: companyEvidence.name,
          status: segment.audience === "customers" ? "customer" : "prospect",
          sources: companyEvidence.sources,
        });
        const lastSeenAt = evidenceRefs.reduce((max, ref) => {
          const time = ref.date ? new Date(ref.date).getTime() : 0;
          return Number.isFinite(time) ? Math.max(max, time) : max;
        }, 0) || Date.now();
        const membership = await ctx.runMutation(internal.prospects.upsertMembership, {
          companyId,
          segmentId: segment._id,
          fitScore: decision.fitScore,
          confidence: decision.confidence,
          stage: decision.stage,
          summary: decision.summary || buildMembershipSummary({ segment, companyName: companyEvidence.name, evidence: evidenceRefs }),
          currentState: decision.currentState ?? evidenceRefs[0]?.snippet,
          scale: decision.scale ?? undefined,
          extraDetails: decision.extraDetails ?? undefined,
          blockers: decision.blockers,
          nextSteps: decision.nextSteps.length > 0
            ? decision.nextSteps
            : ["Review source evidence", "Confirm account owner and current evaluation status"],
          evidenceRefs,
          origin: "ai",
          lastSeenAt,
          outcome: decision.outcome ?? undefined,
          lostToCompetitor: decision.lostToCompetitor ?? undefined,
          lostReason: decision.lostReason ?? undefined,
          competitorsConsidered: decision.competitorsConsidered ?? undefined,
        });
        if (created || membership.created) newCompanies++;
        else updatedCompanies++;
        evidenceCount += evidenceRefs.length;
      } catch (error) {
        console.error(`Failed to upsert membership for ${companyEvidence.domain} in segment ${segment.title}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await ctx.runMutation(internal.prospects.insertSegmentRun, {
      segmentId: segment._id,
      summary:
        grouped.size === 0
          ? `No matching companies found for ${segment.title}.`
          : `${segment.title} reviewed ${grouped.size} candidate companies and kept ${qualified.length} qualified companies with ${evidenceCount} evidence references.`,
      newCompanies,
      updatedCompanies,
      evidenceCount,
      startedAt,
      completedAt: Date.now(),
    });
    totalNewCompanies += newCompanies;
    totalUpdatedCompanies += updatedCompanies;
    totalEvidenceCount += evidenceCount;
  }
  return {
    segments: segments.length,
    newCompanies: totalNewCompanies,
    updatedCompanies: totalUpdatedCompanies,
    evidenceCount: totalEvidenceCount,
  };
}

export const refreshSegment = action({
  args: {
    segmentId: v.optional(v.id("companySegments")),
  },
  handler: async (ctx, args): Promise<{ segments: number; newCompanies: number; updatedCompanies: number; evidenceCount: number }> => {
    await requireAdmin({ ctx });
    return await refreshSegments({ ctx, segmentId: args.segmentId });
  },
});

export const refreshDailySegments = action({
  args: {},
  handler: async (ctx): Promise<{ segments: number; newCompanies: number; updatedCompanies: number; evidenceCount: number }> => {
    await requireAdmin({ ctx });
    return await refreshSegments({ ctx, cadence: "daily" });
  },
});

export const refreshDailySegmentsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ segments: number; newCompanies: number; updatedCompanies: number; evidenceCount: number }> => {
    if (!hasTogetherCredentials()) {
      return { segments: 0, newCompanies: 0, updatedCompanies: 0, evidenceCount: 0 };
    }
    return await refreshSegments({ ctx, cadence: "daily" });
  },
});

export const refreshSegmentInternal = internalAction({
  args: {
    segmentId: v.id("companySegments"),
  },
  handler: async (ctx, args): Promise<{ segments: number; newCompanies: number; updatedCompanies: number; evidenceCount: number }> => {
    return await refreshSegments({ ctx, segmentId: args.segmentId });
  },
});

export const refreshSingleProspect = action({
  args: {
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
  },
  handler: async (ctx, args): Promise<{ accepted: boolean; fitScore: number; stage: string }> => {
    await requireAdmin({ ctx });
    const [segment] = await ctx.runQuery(internal.prospects.getSegmentsForRefresh, { segmentId: args.segmentId });
    if (!segment) throw new Error("Segment not found.");
    const membership = await ctx.runQuery(internal.prospects.getMembershipForCompany, {
      segmentId: args.segmentId,
      companyId: args.companyId,
    });
    if (!membership) throw new Error("Prospect is not tracked in this segment.");
    return await refreshSingleProspectMembership({ ctx, segment, membership });
  },
});

export const getSourceDetail = action({
  args: {
    source: v.union(v.literal("call"), v.literal("support")),
    id: v.string(),
  },
  handler: async (ctx, args): Promise<SourceDetailResult | null> => {
    await requireAuthenticated({ ctx });
    return await ctx.runQuery(internal.dailyInsights.getSourceDetailData, args);
  },
});
