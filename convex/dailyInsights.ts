import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { isAdminEmail, requireAdmin, requireAuthenticated } from "../lib/convex/auth";

type InsightStatus = "review" | "posted" | "dismissed";
type ReportHighlight = Doc<"reports">["highlights"][number];
type DailyInsight = Doc<"dailyInsights">;
type DailyReportWithInsights = {
  id: Id<"reports">;
  periodStart: string;
  periodEnd: string;
  callCount: number;
  ticketCount: number;
  summary: string;
  sentiment: Doc<"reports">["sentiment"];
  generatedAt: number;
  insights: DailyInsight[];
};

export const canAccessDailyReports = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    return (await ctx.auth.getUserIdentity()) !== null;
  },
});

type SlackPostResult = {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
};
type SlackTextBlock = {
  type: "section";
  text: { type: "mrkdwn"; text: string };
};
type SlackFieldsBlock = {
  type: "section";
  fields: Array<{ type: "mrkdwn"; text: string }>;
};
type SlackContextBlock = {
  type: "context";
  elements: Array<
    | { type: "mrkdwn"; text: string }
    | { type: "image"; image_url: string; alt_text: string }
  >;
};
type SlackDividerBlock = { type: "divider" };
type SlackBlock = SlackTextBlock | SlackFieldsBlock | SlackContextBlock | SlackDividerBlock;
type SourcePerson = {
  name?: string;
  email?: string;
};
type SourceDetails = {
  sourceLabel: string;
  sourceTitle?: string;
  sourceUrl?: string;
  people: SourcePerson[];
};
type SourceDetailResult = {
  source: "call" | "support";
  title: string;
  companyDomain?: string;
  date?: string;
  people: SourcePerson[];
  internalPeople?: SourcePerson[];
  sections: Array<{ title: string; text: string }>;
  url?: string;
};
type ParsedInsightDescription = {
  submittedBy?: string;
  customer?: string;
  customerTitle?: string;
  source?: string;
  date?: string;
  productCategory?: string;
  insightCategory?: string;
  whatILearned: string;
};

function getHighlightKey({ highlight, index }: { highlight: ReportHighlight; index: number }): string {
  return `${index}:${highlight.title}`;
}

async function patchInsightStatus({
  ctx,
  insightId,
  status,
  updatedByEmail,
  slackChannel,
  slackMessageTs,
  dismissReason,
}: {
  ctx: MutationCtx;
  insightId: Id<"dailyInsights">;
  status: InsightStatus;
  updatedByEmail?: string;
  slackChannel?: string;
  slackMessageTs?: string;
  dismissReason?: string;
}): Promise<void> {
  const now = Date.now();
  const statusPatch =
    status === "posted"
      ? { postedAt: now, slackChannel, slackMessageTs }
      : status === "dismissed"
        ? { dismissedAt: now, dismissReason }
        : {};

  await ctx.db.patch(insightId, {
    status,
    updatedAt: now,
    updatedByEmail,
    ...statusPatch,
  });
}

export const materializeReportInsights = internalMutation({
  args: {
    reportId: v.id("reports"),
    periodStart: v.string(),
    periodEnd: v.string(),
    generatedAt: v.number(),
    highlights: v.array(
      v.object({
        title: v.string(),
        description: v.string(),
        company: v.optional(v.string()),
        companyDomain: v.optional(v.string()),
        sourceRefs: v.optional(v.array(v.object({
          source: v.union(v.literal("call"), v.literal("support")),
          id: v.string(),
          title: v.optional(v.string()),
        }))),
        sentiment: v.union(v.literal("positive"), v.literal("negative"), v.literal("neutral")),
      })
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    for (const [index, highlight] of args.highlights.entries()) {
      if (highlight.title === "Generation failed") {
        continue;
      }
      const highlightKey = getHighlightKey({ highlight, index });
      const existing = await ctx.db
        .query("dailyInsights")
        .withIndex("by_report_highlight", (q) => q.eq("reportId", args.reportId).eq("highlightKey", highlightKey))
        .unique();
      const doc = {
        reportId: args.reportId,
        highlightKey,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        title: highlight.title,
        description: highlight.description,
        company: highlight.company,
        companyDomain: highlight.companyDomain,
        sourceRefs: highlight.sourceRefs,
        sentiment: highlight.sentiment,
        generatedAt: args.generatedAt,
        updatedAt: Date.now(),
      };

      if (existing) {
        await ctx.db.patch(existing._id, doc);
      } else {
        await ctx.db.insert("dailyInsights", {
          ...doc,
          status: "review",
        });
      }
    }
  },
});

export const listDailyReports = query({
  args: {
    limit: v.optional(v.number()),
    includeDismissed: v.optional(v.boolean()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DailyReportWithInsights[]> => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    const identity = await ctx.auth.getUserIdentity();
    const includeDismissed = (args.includeDismissed ?? false) && isAdminEmail({ email: identity?.email });

    const reports = await ctx.db
      .query("reports")
      .withIndex("by_generated")
      .order("desc")
      .filter((q) => q.eq(q.field("type"), "daily"))
      .take((args.limit ?? 21) * 3);

    const latestByPeriod = new Map<string, (typeof reports)[number]>();
    for (const report of reports) {
      const existing = latestByPeriod.get(report.periodStart);
      if (!existing || report.generatedAt > existing.generatedAt) {
        latestByPeriod.set(report.periodStart, report);
      }
    }
    const latestReports = [...latestByPeriod.values()]
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
      .slice(0, args.limit ?? 21);

    const result: DailyReportWithInsights[] = [];
    for (const report of latestReports) {
      const insights = await ctx.db
        .query("dailyInsights")
        .withIndex("by_report", (q) => q.eq("reportId", report._id))
        .collect();
      const visibleInsights = includeDismissed
        ? insights
        : insights.filter((insight) => insight.status !== "dismissed");
      if (visibleInsights.length === 0) continue;

      result.push({
        id: report._id,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        callCount: report.callCount,
        ticketCount: report.ticketCount,
        summary: report.summary,
        sentiment: report.sentiment,
        generatedAt: report.generatedAt,
        insights: visibleInsights.sort((a, b) => a.highlightKey.localeCompare(b.highlightKey)),
      });
    }

    return result;
  },
});

export const listInsightsForPeriod = internalQuery({
  args: {
    from: v.string(),
    to: v.string(),
  },
  handler: async (ctx, args): Promise<DailyInsight[]> => {
    const insights = await ctx.db.query("dailyInsights").collect();
    return insights
      .filter((insight) => insight.periodStart >= args.from && insight.periodEnd <= args.to)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  },
});

export const setReviewStatus = mutation({
  args: {
    insightId: v.id("dailyInsights"),
    status: v.union(v.literal("review"), v.literal("dismissed")),
    dismissReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const email = await requireAdmin({ ctx });
    await patchInsightStatus({
      ctx,
      insightId: args.insightId,
      status: args.status,
      updatedByEmail: email,
      dismissReason: args.dismissReason,
    });
  },
});

export const markPostedAfterSlack = internalMutation({
  args: {
    insightId: v.id("dailyInsights"),
    updatedByEmail: v.optional(v.string()),
    slackChannel: v.optional(v.string()),
    slackMessageTs: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await patchInsightStatus({
      ctx,
      insightId: args.insightId,
      status: "posted",
      updatedByEmail: args.updatedByEmail,
      slackChannel: args.slackChannel,
      slackMessageTs: args.slackMessageTs,
    });
  },
});

function stripSourcePrefix({ id }: { id: string }): string {
  const withoutPrefix = id.replace(/^(call|support):/, "");
  return withoutPrefix.split("|")[0]!.trim();
}

function sourceUrl({ source, id }: { source: "call" | "support"; id: string }): string | undefined {
  const cleanId = stripSourcePrefix({ id });
  if (source === "call") return `https://app.gong.io/call?id=${encodeURIComponent(cleanId)}`;
  return undefined;
}

function chunkNumericSuffix({ chunkId }: { chunkId: string }): number {
  const match = chunkId.match(/-(\d+)$/);
  return match ? Number.parseInt(match[1]!, 10) : Number.POSITIVE_INFINITY;
}

function compareTranscriptChunks({
  a,
  b,
}: {
  a: Doc<"chunks">;
  b: Doc<"chunks">;
}): number {
  const startDelta = (a.startSec ?? Number.POSITIVE_INFINITY) - (b.startSec ?? Number.POSITIVE_INFINITY);
  if (startDelta !== 0) return startDelta;
  const endDelta = (a.endSec ?? Number.POSITIVE_INFINITY) - (b.endSec ?? Number.POSITIVE_INFINITY);
  if (endDelta !== 0) return endDelta;
  const indexDelta = chunkNumericSuffix({ chunkId: a.chunkId }) - chunkNumericSuffix({ chunkId: b.chunkId });
  if (indexDelta !== 0) return indexDelta;
  return a.chunkId.localeCompare(b.chunkId);
}

function dedupePeople({ people, limit = 3 }: { people: SourcePerson[]; limit?: number }): SourcePerson[] {
  const seen = new Set<string>();
  const deduped: SourcePerson[] = [];
  for (const person of people) {
    const key = (person.email ?? person.name ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(person);
  }
  return deduped.slice(0, limit);
}

function normalizeSpeakerName({ value }: { value?: string }): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function speakerNameParts({ value }: { value?: string }): string[] {
  return normalizeSpeakerName({ value })
    .split(/\s+/)
    .filter((part) => part.length >= 3);
}

function matchesSpeakerName({
  speaker,
  person,
}: {
  speaker: string;
  person: SourcePerson;
}): boolean {
  const normalizedSpeaker = normalizeSpeakerName({ value: speaker });
  const normalizedName = normalizeSpeakerName({ value: person.name });
  if (normalizedName.length >= 3 && (
    normalizedSpeaker.includes(normalizedName) ||
    normalizedName.includes(normalizedSpeaker)
  )) {
    return true;
  }

  const nameParts = speakerNameParts({ value: person.name });
  if (nameParts.length >= 2 && nameParts.every((part) => normalizedSpeaker.includes(part))) {
    return true;
  }

  const emailParts = speakerNameParts({ value: person.email?.split("@")[0] });
  if (emailParts.length >= 2 && emailParts.every((part) => normalizedSpeaker.includes(part))) {
    return true;
  }
  if (emailParts.length === 1 && normalizedSpeaker === emailParts[0]) {
    return true;
  }

  return false;
}

function isActiveInternalSlackUser({ user }: { user: Doc<"slackUserCache"> }): boolean {
  return !user.deleted && !user.isBot && !user.isRestricted && !user.isUltraRestricted && !user.isStranger;
}

function slackUserToSourcePerson({ user }: { user: Doc<"slackUserCache"> }): SourcePerson {
  return {
    name: user.realName ?? user.displayName ?? user.username,
    email: user.email,
  };
}

async function getInternalPeopleForSpeakers({
  ctx,
  speakerNames,
  limit = 30,
}: {
  ctx: QueryCtx;
  speakerNames: string[];
  limit?: number;
}): Promise<SourcePerson[]> {
  const names = [...new Set(speakerNames.map((speaker) => speaker.trim()).filter(Boolean))];
  if (names.length === 0) return [];

  const users = await ctx.db.query("slackUserCache").collect();
  const matchedPeople = users
    .filter((user) => isActiveInternalSlackUser({ user }))
    .map((user) => slackUserToSourcePerson({ user }))
    .filter((person) => names.some((speaker) => matchesSpeakerName({ speaker, person })));

  return dedupePeople({ people: matchedPeople, limit });
}

function formatPerson({ person }: { person: SourcePerson }): string {
  if (person.email && person.name) return `${person.name} <${person.email}>`;
  return person.email ?? person.name ?? "";
}

function faviconUrl({ domain }: { domain?: string }): string | null {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function trimForSlack({ text, maxLength }: { text: string; maxLength: number }): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function escapeSlackText({ text }: { text: string }): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseInsightDescription({ description }: { description: string }): ParsedInsightDescription {
  const labels = [
    "Submitted By",
    "Customer",
    "Customer Title",
    "Source",
    "Date",
    "Product Category",
    "Insight Category",
    "What I Learned",
  ];
  const normalized = description.trim();
  const labelPattern = new RegExp(`(?:^|[\\n.,;]\\s*)(${labels.join("|")}):\\s*`, "gi");
  const matches = [...normalized.matchAll(labelPattern)];
  if (matches.length === 0) return { whatILearned: normalized };

  const values = new Map<string, string>();
  for (const [index, match] of matches.entries()) {
    const rawLabel = match[1];
    if (!rawLabel) continue;
    const valueStart = match.index! + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? normalized.length;
    const value = normalized
      .slice(valueStart, valueEnd)
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[.,;]\s*$/, "");
    if (value) values.set(rawLabel.toLowerCase(), value);
  }

  return {
    submittedBy: values.get("submitted by"),
    customer: values.get("customer"),
    customerTitle: values.get("customer title"),
    source: values.get("source"),
    date: values.get("date"),
    productCategory: values.get("product category"),
    insightCategory: values.get("insight category"),
    whatILearned: values.get("what i learned") ?? normalized,
  };
}

function slackField({ label, value }: { label: string; value: string | undefined }): { type: "mrkdwn"; text: string } | null {
  if (!value || value.toLowerCase() === "unknown") return null;
  return {
    type: "mrkdwn",
    text: `*${label}:*\n${escapeSlackText({ text: trimForSlack({ text: value, maxLength: 120 }) })}`,
  };
}

function cleanPylonChunkText({ text }: { text: string }): string {
  const metadataPrefixes = [
    "ISSUE:",
    "Company:",
    "Domain:",
    "State:",
    "Tags:",
    "Requester:",
    "Assignee:",
    "Priority:",
    "Category:",
  ];
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !metadataPrefixes.some((prefix) => line.startsWith(prefix)));
  const hasSpeakerLines = lines.some((line) => /^[^:]{2,80}: /.test(line));
  if (!hasSpeakerLines) return lines.join("\n\n");

  return lines
    .filter((line) => /^[^:]{2,80}: /.test(line))
    .join("\n\n");
}

async function getSourceDetails({
  ctx,
  insight,
}: {
  ctx: ActionCtx;
  insight: DailyInsight;
}): Promise<SourceDetails | null> {
  const sourceRef = insight.sourceRefs?.[0];
  if (!sourceRef) return null;
  const cleanId = stripSourcePrefix({ id: sourceRef.id });

  if (sourceRef.source === "call") {
    const call = await ctx.runQuery(internal.dailyInsights.getCallByGongId, { gongId: cleanId });
    return {
      sourceLabel: "Gong call",
      sourceTitle: sourceRef.title ?? call?.title,
      sourceUrl: sourceUrl({ source: sourceRef.source, id: cleanId }),
      people: dedupePeople({
        people: (call?.parties ?? []).map((party) => ({
          name: party.name,
          email: party.emailAddress,
        })),
      }),
    };
  }

  const issue = await ctx.runQuery(internal.dailyInsights.getIssueByPylonId, { pylonId: cleanId });
  return {
    sourceLabel: "Pylon ticket",
    sourceTitle: sourceRef.title ?? issue?.title,
    sourceUrl: issue?.link,
    people: dedupePeople({
      people: [
        { email: issue?.requesterEmail },
        { email: issue?.assigneeEmail },
      ],
    }),
  };
}

function buildSlackFallback({
  insight,
}: {
  insight: DailyInsight;
}): string {
  const client = insight.company ?? insight.companyDomain ?? "Customer signal";
  const sentimentLabel = insight.sentiment.charAt(0).toUpperCase() + insight.sentiment.slice(1);
  const parsed = parseInsightDescription({ description: insight.description });
  return `Daily customer insight: ${insight.title}\nCustomer: ${client}\nSignal: ${sentimentLabel}\n${parsed.whatILearned}`;
}

function buildSlackBlocks({
  insight,
  sourceDetails,
}: {
  insight: DailyInsight;
  sourceDetails: SourceDetails | null;
}): SlackBlock[] {
  const client = insight.company ?? insight.companyDomain ?? "Customer signal";
  const sentimentLabel = insight.sentiment.charAt(0).toUpperCase() + insight.sentiment.slice(1);
  const icon = faviconUrl({ domain: insight.companyDomain });
  const parsed = parseInsightDescription({ description: insight.description });
  const contextElements: SlackContextBlock["elements"] = [];
  if (icon) contextElements.push({ type: "image", image_url: icon, alt_text: client });
  contextElements.push({ type: "mrkdwn", text: `*${client}* · ${sentimentLabel} signal · Daily insight` });

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${escapeSlackText({ text: insight.title })}*`,
      },
    },
    {
      type: "context",
      elements: contextElements,
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*What I learned*\n${escapeSlackText({ text: trimForSlack({ text: parsed.whatILearned, maxLength: 900 }) })}`,
      },
    },
    { type: "divider" },
  ];

  const fields = [
    slackField({ label: "Submitted by", value: parsed.submittedBy }),
    slackField({ label: "Customer title", value: parsed.customerTitle }),
    slackField({ label: "Product", value: parsed.productCategory }),
    slackField({ label: "Category", value: parsed.insightCategory }),
    slackField({ label: "Date", value: parsed.date }),
    slackField({ label: "Source type", value: parsed.source }),
  ].filter((field): field is { type: "mrkdwn"; text: string } => field !== null);

  if (fields.length > 0) {
    blocks.push({
      type: "section",
      fields: fields.slice(0, 6),
    });
  }

  if (sourceDetails?.people.length) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*People:* ${sourceDetails.people.map((person) => formatPerson({ person })).filter(Boolean).map((person) => escapeSlackText({ text: person })).join(", ")}`,
        },
      ],
    });
  }

  if (sourceDetails) {
    const sourceTitle = sourceDetails.sourceTitle ?? sourceDetails.sourceLabel;
    const escapedTitle = escapeSlackText({ text: sourceTitle });
    const sourceText = sourceDetails.sourceUrl
      ? `*Source:* <${sourceDetails.sourceUrl}|${escapedTitle}>`
      : `*Source:* ${escapedTitle}`;
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: sourceText }],
    });
  }

  return blocks;
}

export const getCallByGongId = internalQuery({
  args: { gongId: v.string() },
  handler: async (ctx, args): Promise<Doc<"calls"> | null> => {
    return await ctx.db
      .query("calls")
      .withIndex("by_gong_id", (q) => q.eq("gongId", args.gongId))
      .unique();
  },
});

export const getIssueByPylonId = internalQuery({
  args: { pylonId: v.string() },
  handler: async (ctx, args): Promise<Doc<"pylonIssues"> | null> => {
    return await ctx.db
      .query("pylonIssues")
      .withIndex("by_pylon_id", (q) => q.eq("pylonId", args.pylonId))
      .unique();
  },
});

export const getSourceDetailData = internalQuery({
  args: {
    source: v.union(v.literal("call"), v.literal("support")),
    id: v.string(),
  },
  handler: async (ctx, args): Promise<SourceDetailResult | null> => {
    const cleanId = stripSourcePrefix({ id: args.id });
    if (args.source === "call") {
      const call = await ctx.db
        .query("calls")
        .withIndex("by_gong_id", (q) => q.eq("gongId", cleanId))
        .unique();
      if (!call) return null;
      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_source", (q) => q.eq("dataSource", "gong").eq("sourceId", cleanId))
        .collect();
      const sortedChunks = chunks.sort((a, b) => compareTranscriptChunks({ a, b }));
      const internalPeople = await getInternalPeopleForSpeakers({
        ctx,
        speakerNames: sortedChunks.flatMap((chunk) => chunk.speakers ?? []),
      });
      return {
        source: "call",
        title: call.title,
        companyDomain: call.companyDomain,
        date: call.started,
        people: dedupePeople({
          people: call.parties.map((party) => ({
            name: party.name,
            email: party.emailAddress,
          })),
          limit: 30,
        }),
        internalPeople,
        sections: [
          ...(call.brief ? [{ title: "Brief", text: call.brief }] : []),
          ...((call.keyPoints ?? []).length > 0 ? [{ title: "Key points", text: call.keyPoints!.join("\n") }] : []),
          ...sortedChunks
            .filter((chunk) => (chunk.speakers?.length ?? 0) > 0)
            .map((chunk) => ({ title: chunk.speakers?.join(", ") || "Transcript", text: chunk.text })),
        ],
        url: sourceUrl({ source: "call", id: cleanId }),
      };
    }

    const issue = await ctx.db
      .query("pylonIssues")
      .withIndex("by_pylon_id", (q) => q.eq("pylonId", cleanId))
      .unique();
    if (!issue) return null;
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_source", (q) => q.eq("dataSource", "pylon").eq("sourceId", cleanId))
      .collect();
    const sortedChunks = chunks.sort((a, b) => a.chunkId.localeCompare(b.chunkId));
    const internalPeople = await getInternalPeopleForSpeakers({
      ctx,
      speakerNames: sortedChunks.flatMap((chunk) => chunk.authors ?? []),
    });
    return {
      source: "support",
      title: issue.title,
      companyDomain: issue.companyDomain,
      date: issue.createdAt,
      people: dedupePeople({
        people: [
          { email: issue.requesterEmail },
          { email: issue.assigneeEmail },
        ],
      }),
      internalPeople,
      sections: [
        {
          title: "Ticket metadata",
          text: [
            issue.priority ? `Priority: ${issue.priority}` : null,
            issue.state ? `State: ${issue.state}` : null,
            issue.issueCategory ? `Category: ${issue.issueCategory}` : null,
          ].filter((line): line is string => line !== null).join("\n"),
        },
        // Merge all chunks into a single conversation so the thread reads as one
        // coherent exchange rather than N separate panels.
        (() => {
          const conversationText = sortedChunks
            .slice(0, 12)
            .map((chunk) => cleanPylonChunkText({ text: chunk.text }))
            .filter((t) => t.trim().length > 0)
            .join("\n\n");
          return conversationText.trim()
            ? { title: "Conversation", text: conversationText }
            : null;
        })(),
      ].filter((section): section is { title: string; text: string } => section !== null && section.text.trim().length > 0),
      url: issue.link,
    };
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

export const getInsight = internalQuery({
  args: { insightId: v.id("dailyInsights") },
  handler: async (ctx, args): Promise<DailyInsight | null> => {
    return await ctx.db.get(args.insightId);
  },
});

export const postToSlack = action({
  args: {
    insightId: v.id("dailyInsights"),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const email = await requireAdmin({ ctx });
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID;

    if (!slackToken) throw new Error("SLACK_BOT_TOKEN is not set");
    if (!channel) throw new Error("SLACK_CHANNEL_ID is not set");

    const insight = await ctx.runQuery(internal.dailyInsights.getInsight, {
      insightId: args.insightId,
    });
    if (!insight) throw new Error("Daily insight not found");

    const sourceDetails = await getSourceDetails({ ctx, insight });
    const text = buildSlackFallback({ insight });
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        mrkdwn: true,
        text,
        blocks: buildSlackBlocks({ insight, sourceDetails }),
      }),
    });

    const result = (await response.json()) as SlackPostResult;
    if (!response.ok || !result.ok) {
      throw new Error(`Slack API error: ${result.error ?? response.statusText}`);
    }

    await ctx.runMutation(internal.dailyInsights.markPostedAfterSlack, {
      insightId: args.insightId,
      updatedByEmail: email,
      slackChannel: result.channel,
      slackMessageTs: result.ts,
    });

    return { ok: true };
  },
});
