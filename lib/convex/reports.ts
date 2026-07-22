import { z } from "zod";
import type { Doc } from "../../convex/_generated/dataModel";

export type ReportType = "daily";
export type ReportSentiment = Doc<"reports">["sentiment"];
export type ReportHighlight = Doc<"reports">["highlights"][number];
export type ReportOutput = Pick<Doc<"reports">, "summary" | "sentiment" | "highlights">;
export type ReportData = {
  callCount: number;
  ticketCount: number;
  promptData: string;
};
export type SourceContentData = {
  sourceId: string;
  text: string;
};

const MAX_DAILY_DATA_CHARS = 30000;
const IMPORTANT_TICKET_LIMIT = 24;
const DAILY_CALL_LIMIT = 12;
const DAILY_TICKET_LIMIT_WITH_CALLS = 8;
const DAILY_TICKET_LIMIT_WITHOUT_CALLS = 14;
const DAILY_SOURCE_CHARS = 1250;
const DAILY_REPORT_TIME_ZONE = "America/Los_Angeles";

const DAILY_SCHEMA_HINT = `{
  "summary": "maximum 2 sentences and maximum 55 words",
  "sentiment": { "positive": 0-100, "negative": 0-100, "neutral": 0-100 },
  "highlights": [
    {
      "title": "Customer name + specific issue or opportunity",
      "description": "Submitted By: name/email or Unknown\\nCustomer: company or Unknown\\nCustomer Title: role/title or Unknown\\nSource: Call or Support ticket\\nDate: YYYY-MM-DD\\nProduct Category: one allowed category\\nInsight Category: one allowed category\\nWhat I Learned: one 70-120 word paragraph with concrete details from the source",
      "company": "optional display name or null",
      "companyDomain": "optional domain without protocol or null",
      "sourceRefs": [{ "source": "call|support", "id": "source id from data", "title": "optional source title" }],
      "sentiment": "positive|negative|neutral"
    }
  ]
}`;

function schemaHintForType(): string {
  return DAILY_SCHEMA_HINT;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

function addUtcDays({ date, days }: { date: Date; days: number }): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getUtcDateOnly({ date }: { date: Date }): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function cleanSourceRefId({ id }: { id: string }): string {
  return id
    .replace(/^(?:(?:call|support):)+/, "")
    .split("|")[0]!
    .trim();
}

export function computePeriod(type: ReportType): { periodStart: string; periodEnd: string } {
  const now = getUtcDateOnly({ date: new Date() });

  return {
    periodStart: toDateStr(addUtcDays({ date: now, days: -1 })),
    periodEnd: toDateStr(now),
  };
}

function parseDateOnly({ dateStr }: { dateStr: string }): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid date: ${dateStr}`);
  return { year, month, day };
}

function getTimeZoneOffsetMs({ date, timeZone }: { date: Date; timeZone: string }): number {
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = timeZoneName?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

function getZonedMidnightUtc({ dateStr, timeZone }: { dateStr: string; timeZone: string }): string {
  const { year, month, day } = parseDateOnly({ dateStr });
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const firstOffset = getTimeZoneOffsetMs({ date: utcNoon, timeZone });
  const firstGuess = new Date(Date.UTC(year, month - 1, day) - firstOffset);
  const finalOffset = getTimeZoneOffsetMs({ date: firstGuess, timeZone });
  return new Date(Date.UTC(year, month - 1, day) - finalOffset).toISOString();
}

function subtractOneMs({ isoDate }: { isoDate: string }): string {
  return new Date(new Date(isoDate).getTime() - 1).toISOString();
}

export function computeDailyDataRange({
  periodStart,
  periodEnd,
}: {
  periodStart: string;
  periodEnd: string;
}): { from: string; to: string } {
  const from = getZonedMidnightUtc({ dateStr: periodStart, timeZone: DAILY_REPORT_TIME_ZONE });
  const nextMidnight = getZonedMidnightUtc({ dateStr: periodEnd, timeZone: DAILY_REPORT_TIME_ZONE });
  return { from, to: subtractOneMs({ isoDate: nextMidnight }) };
}

export function isFailedReport(report: Pick<Doc<"reports">, "highlights"> | null | undefined): boolean {
  return report?.highlights[0]?.title === "Generation failed";
}

const sourceRefSchema = z.object({
  source: z.enum(["call", "support"]),
  id: z.string(),
  title: z.string().optional(),
});

const highlightSchema = z.object({
  title: z.string(),
  description: z.string(),
  company: z.string().nullish(),
  companyDomain: z.string().nullish(),
  sourceRefs: z.array(sourceRefSchema).optional(),
  sentiment: z.enum(["positive", "negative", "neutral"]),
});

export const reportOutputSchema = z.object({
  summary: z.string(),
  sentiment: z.object({
    positive: z.number(),
    negative: z.number(),
    neutral: z.number(),
  }),
  highlights: z.array(highlightSchema).max(10),
});

export type RawReportOutput = z.infer<typeof reportOutputSchema>;

export function mapRawToReportOutput({ raw }: { raw: RawReportOutput }): ReportOutput {
  return {
    summary: raw.summary,
    sentiment: {
      positive: Math.max(0, Math.min(100, raw.sentiment.positive)),
      negative: Math.max(0, Math.min(100, raw.sentiment.negative)),
      neutral: Math.max(0, Math.min(100, raw.sentiment.neutral)),
    },
    highlights: raw.highlights.slice(0, 10).map((h): ReportHighlight => ({
      title: h.title || "Untitled highlight",
      description: h.description || "",
      company: h.company ?? undefined,
      companyDomain: h.companyDomain ?? undefined,
      sourceRefs: h.sourceRefs?.map((ref) => ({
        source: ref.source,
        id: cleanSourceRefId({ id: ref.id }),
        title: ref.title,
      })),
      sentiment: h.sentiment,
    })),
  };
}

export function buildPrompt({
  type,
  periodStart,
  periodEnd,
  promptData,
}: {
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  promptData: string;
}): string {
  const dailyInstructions = type === "daily"
    ? `Daily report requirements:
- Keep summary extremely short: maximum 2 sentences, maximum 55 words.
- The summary should say only what changed or what needs attention today.
- Highlights are the main product; prefer 4-8 source-backed atomic insights, ordered by severity/impact.
- Each highlight must represent one specific piece of customer feedback. Do not bundle unrelated topics.
- Never create more than one highlight from the same call or support ticket. If one source contains multiple possible lessons, choose the single most executive-relevant lesson and write one richer insight for that source.
- Treat calls as the primary source of strategic customer learning. When calls exist for the day, the majority of highlights should come from calls unless the calls contain no actionable feedback.
- Tickets are secondary evidence. Include ticket-only highlights only when they expose executive-relevant learning: repeated product gap, high-impact customer blocker, pricing/billing pattern, competitive risk, launch/model availability issue, security/compliance concern, or clear self-serve/product workflow failure.
- Do not promote ordinary support work into insights: one-off bugs already assigned to engineering, common support questions, password/account chores, routine configuration help, normal infra/cluster operations, or issues that are merely being fixed should be ignored unless they reveal a deeper product/customer pattern.
- Index heavily on negative feedback, blockers, pricing concerns, competitive risk, and customer friction. Include positive signals only when they are concrete and important.
- By default exclude infrastructure, cluster, and GPU hardware issues, including GPU hardware failures (XID errors, ECC errors, thermal throttling, NVIDIA component failures, ERGATOS_PROBE_FAILED), node failures (NotReady nodes, unhealthy nodes, duplicate IPs, bad NICs, node reboots/reimages, node not recognized by SLURM), head node drops, storage issues (disk pressure, no-space alarms, etcd NOSPACE, WekaFS errors, NFS unmounts, volume mount failures, filesystem lockups), networking issues (SSH drops, MTU mismatches, VLAN or Layer 2 issues, InfiniBand/fabric contention, Allreduce stalls, connectivity outages), cluster provisioning issues (package mismatches, new node setup problems), Kubernetes/pod health issues (probe failures, crashloops, kubelet/node readiness), and any ticket primarily about a Forge/GPU cluster substrate being down or degraded.
- Treat dedicated endpoint failures on named GPU capacity (for example H100/B200/GB200, 503s, service_unavailable, degraded dedicated endpoints, cluster-backed endpoint outages) as infrastructure/substrate noise and exclude them by default.
- Keep product-level reliability only when it is clearly not cluster/GPU substrate, such as serverless throttling, public API rate limits, model availability, billing, docs, and account workflows.
- Only include a cluster/GPU/node incident if the source explicitly shows account-level business risk or a reusable product lesson, such as threatened cancellation/churn, contract/SLA impact, repeated systemic pattern across many customers, pricing/renewal impact, or a missing self-serve workflow. A single customer asking support to fix a node, disk, mount, SLURM, probe, GPU, or cluster outage is not a daily insight.
- For each highlight title, name the customer and specific issue when possible.
- For each highlight description, use this exact newline-delimited format with every label present: Submitted By, Customer, Customer Title, Source, Date, Product Category, Insight Category, What I Learned. If a field is not available, write "Unknown" rather than inventing it.
- Make "What I Learned" slightly longer and more specific than a normal summary: write one 70-120 word paragraph with concrete numbers, model names, vendor/provider names, product names, pricing/spend, workflow details, blockers, and explicit customer evaluation criteria when present in the source. Do not pad with generic recommendations.
- Good "What I Learned" paragraphs should read like the example feedback style: specific customer context, what they tried, what failed or worked, why it matters commercially or competitively, and the exact next opportunity or risk implied by the source.
- Product Category must be one of: Infrastructure as a Service (IaaS), Infra Foundations, Inference, Model Shaping, Product Foundations (Previously G&C), Developer Experience, Security.
- Insight Category must be one of: Product, Competitive, User Experience, Marketing, Pricing, Sales.
- Include direct quotes only when they appear in the source text and materially sharpen the insight.
- Every highlight should include sourceRefs pointing to the supporting call or support ticket.
- Avoid ticket distribution recaps, generic conclusions, vague "customers want better UX" language, and recommendations.`
    : "";

  return `You are generating a ${type} customer feedback report covering ${periodStart} to ${periodEnd}.

${promptData}

Generate a structured report that:
- Highlights the most important themes and trends across calls and tickets
- Flags any critical issues, escalations, or negative sentiment patterns
- For weekly and monthly reports, when urgent or high priority support tickets are present, include specific ticket-level highlights with sourceRefs instead of only aggregate category summaries
- Includes sourceRefs on highlights when the supporting data provides Source ref values
- Provides an overall sentiment assessment
${dailyInstructions}

Output schema:
${schemaHintForType()}`;
}

function clampWords({ text, maxWords }: { text: string; maxWords: number }): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function firstSentences({ text, maxSentences }: { text: string; maxSentences: number }): string {
  const protectedPeriod = "__PROTECTED_PERIOD__";
  const protectedText = text.replace(/([A-Za-z0-9])\.([A-Za-z0-9])/g, `$1${protectedPeriod}$2`);
  const sentences = protectedText
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean);
  if (!sentences || sentences.length === 0) return text.trim();
  return sentences.slice(0, maxSentences).join(" ").replaceAll(protectedPeriod, ".");
}

export function normalizeReportOutput({
  type,
  output,
}: {
  type: ReportType;
  output: ReportOutput;
}): ReportOutput {
  return {
    ...output,
    summary: clampWords({
      text: firstSentences({ text: output.summary, maxSentences: 2 }),
      maxWords: 55,
    }),
  };
}

function priorityRank({ priority }: { priority: string | undefined }): number {
  if (priority === "critical") return 0;
  if (priority === "urgent") return 0;
  if (priority === "high") return 1;
  if (priority === "medium") return 2;
  if (priority === "low") return 3;
  return 4;
}

export function selectImportantTickets({
  tickets,
  limit = IMPORTANT_TICKET_LIMIT,
}: {
  tickets: Doc<"pylonIssues">[];
  limit?: number;
}): Doc<"pylonIssues">[] {
  return [...tickets]
    .filter((ticket) => ticket.state?.toLowerCase() !== "closed")
    .sort((a, b) => {
      const priorityDelta = priorityRank({ priority: a.priority }) - priorityRank({ priority: b.priority });
      if (priorityDelta !== 0) return priorityDelta;
      return b.createdAt.localeCompare(a.createdAt);
    })
    .slice(0, limit);
}

function truncateText({ text, maxChars }: { text: string; maxChars: number }): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 18).trim()} ... [truncated]`;
}

function contentMap({ sourceContent }: { sourceContent: SourceContentData[] }): Map<string, string> {
  return new Map(sourceContent.map((item) => [item.sourceId, item.text]));
}

function formatDailyCalls({
  calls,
  callContent,
}: {
  calls: Doc<"calls">[];
  callContent: SourceContentData[];
}): string {
  const chunksBySourceId = contentMap({ sourceContent: callContent });
  return calls
    .slice(0, DAILY_CALL_LIMIT)
    .map((call) => {
      const participants = call.parties
        .slice(0, 8)
        .map((party) => party.emailAddress ? `${party.name} <${party.emailAddress}>` : party.name)
        .join(", ");
      const transcript = chunksBySourceId.get(call.gongId) ?? [...(call.keyPoints ?? []), call.brief].filter(Boolean).join(" ");
      return [
        `Source ref: call:${call.gongId}`,
        `Title: ${call.title}`,
        `Date: ${call.started}`,
        `Company domain: ${call.companyDomain ?? "unknown"}`,
        `Participants: ${participants || "unknown"}`,
        `Content: ${truncateText({ text: transcript, maxChars: DAILY_SOURCE_CHARS })}`,
      ].join("\n");
    })
    .join("\n\n");
}

function formatDailyTickets({
  tickets,
  ticketContent,
  hasCalls,
}: {
  tickets: Doc<"pylonIssues">[];
  ticketContent: SourceContentData[];
  hasCalls: boolean;
}): string {
  const chunksBySourceId = contentMap({ sourceContent: ticketContent });
  const limit = hasCalls ? DAILY_TICKET_LIMIT_WITH_CALLS : DAILY_TICKET_LIMIT_WITHOUT_CALLS;
  return selectImportantTickets({ tickets, limit })
    .map((ticket) => {
      const tags = ticket.tags.length > 0 ? ticket.tags.join(", ") : "none";
      const thread = chunksBySourceId.get(ticket.pylonId) ?? "";
      return [
        `Source ref: support:${ticket.pylonId}`,
        `Title: ${ticket.title}`,
        `Date: ${ticket.createdAt}`,
        `Company: ${ticket.companyName ?? "unknown"}`,
        `Domain: ${ticket.companyDomain ?? "unknown"}`,
        `Requester: ${ticket.requesterEmail ?? "unknown"}`,
        `Assignee: ${ticket.assigneeEmail ?? "unknown"}`,
        `Priority/state/category/source: ${ticket.priority ?? "unknown"} / ${ticket.state} / ${ticket.issueCategory ?? "Uncategorized"} / ${ticket.source}`,
        `Tags: ${tags}`,
        `Content: ${truncateText({ text: thread, maxChars: DAILY_SOURCE_CHARS })}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function buildDailyPromptData({
  calls,
  tickets,
  callContent = [],
  ticketContent = [],
}: {
  calls: Doc<"calls">[];
  tickets: Doc<"pylonIssues">[];
  callContent?: SourceContentData[];
  ticketContent?: SourceContentData[];
}): ReportData | null {
  const callCount = calls.length;
  const ticketCount = tickets.length;
  if (callCount === 0 && ticketCount === 0) return null;

  let dataLines = `Coverage: ${callCount} calls and ${ticketCount} support tickets. Calls and tickets were fetched separately. Use calls as the primary learning source; tickets below are only high-priority candidates and should be included only when they reveal strategic product/customer learning beyond routine support.\n\n`;
  const callLines = formatDailyCalls({ calls, callContent });
  const ticketLines = formatDailyTickets({ tickets, ticketContent, hasCalls: callCount > 0 });

  if (callLines) {
    dataLines += `Calls to read:\n${callLines}\n\n`;
  } else {
    dataLines += "Calls to read: none found for this period.\n\n";
  }

  if (ticketLines) {
    dataLines += `Support tickets to read:\n${ticketLines}\n\n`;
  } else {
    dataLines += "Support tickets to read: none found for this period.\n\n";
  }

  if (dataLines.length > MAX_DAILY_DATA_CHARS) {
    dataLines = `${dataLines.slice(0, MAX_DAILY_DATA_CHARS)}\n... (truncated)`;
  }

  return { callCount, ticketCount, promptData: `Data:\n${dataLines}` };
}
