import { z } from "zod";
import type { Doc } from "../../convex/_generated/dataModel";

export type CompanyStatus = Doc<"companyProfiles">["status"];
export type CompanySource = Doc<"companyProfiles">["sources"][number];
export type SegmentStatus = Doc<"companySegments">["status"];
export type SegmentAudience = Doc<"companySegments">["audience"];
export type RefreshCadence = Doc<"companySegments">["refreshCadence"];
export type SegmentSeed = {
  slug: string;
  title: string;
  description: string;
  audience: SegmentAudience;
  detectionPrompt: string;
  searchQueries: string[];
  positiveSignals: string[];
  negativeSignals: string[];
  refreshCadence: RefreshCadence;
};
export type EvidenceRef = Doc<"companySegmentMemberships">["evidenceRefs"][number];
export type ProspectClassificationCandidate = {
  domain: string;
  name: string;
  slackChannel?: {
    id: string;
    name: string;
  };
  slackMessages?: Array<{
    date?: string;
    author?: string;
    text: string;
  }>;
  evidence: Array<{
    index: number;
    source: EvidenceRef["source"];
    title?: string;
    date?: string;
    snippet: string;
  }>;
};

export const prospectOutcomeSchema = z.enum(["active", "lost", "won", "stalled"]);
export type ProspectOutcome = z.infer<typeof prospectOutcomeSchema>;

export const prospectClassificationOutputSchema = z.object({
  decisions: z.array(z.object({
    domain: z.string(),
    accepted: z.boolean(),
    fitScore: z.number().min(0).max(100),
    confidence: z.enum(["low", "medium", "high"]),
    stage: z.string().min(1).max(80),
    summary: z.string().min(1).max(600),
    currentState: z.string().nullish(),
    scale: z.string().nullish(),
    extraDetails: z.array(z.string().min(1).max(220)).max(6).nullish(),
    blockers: z.array(z.string().min(1).max(160)).max(6),
    nextSteps: z.array(z.string().min(1).max(180)).max(6),
    evidenceIndexes: z.array(z.number().int().min(0)).max(8),
    rejectionReason: z.string().nullish(),
    outcome: prospectOutcomeSchema.nullish(),
    lostToCompetitor: z.string().min(1).max(80).nullish(),
    lostReason: z.string().min(1).max(300).nullish(),
    competitorsConsidered: z.array(z.string().min(1).max(60)).max(5).nullish(),
  })).min(1).max(30),
});

export type ProspectClassificationOutput = z.infer<typeof prospectClassificationOutputSchema>;
export type ProspectClassificationDecision = ProspectClassificationOutput["decisions"][number];

export const PROVISIONED_THROUGHPUT_SEGMENT_SLUG = "provisioned-throughput-prospects";
export const LEGACY_DEFAULT_SEGMENT_SLUGS = [
  "oss-migration",
  "provisioned-capacity",
  "migrate-claude-code",
] as const;

export const DEFAULT_COMPANY_SEGMENTS: SegmentSeed[] = [
  {
    slug: PROVISIONED_THROUGHPUT_SEGMENT_SLUG,
    title: "Provisioned throughput",
    description: "potential PT prospects and information about them",
    audience: "prospects",
    detectionPrompt:
      "Find companies that may need Together provisioned throughput because they have high-volume inference, dedicated capacity needs, predictable latency or throughput requirements, coding-agent or Claude Code migration pressure, OSS migration pressure, production scale, committed token volume, SLAs, or rate-limit constraints.",
    searchQueries: [
      "provisioned throughput reserved capacity tokens per minute",
      "guaranteed inference capacity dedicated endpoint",
      "need predictable token volume for model usage",
      "high volume inference capacity commitment",
      "provisioned throughput conversation POC pricing packaging",
      "dedicated capacity SLAs production traffic reserved endpoint",
      "Claude Code migration open source coding agent throughput",
      "coding agent production scale dedicated capacity",
      "closed source model to open source migration high volume inference",
      "Anthropic OpenAI migration committed capacity Together",
    ],
    positiveSignals: [
      "Asks for committed throughput, reserved capacity, or tokens per minute",
      "Needs dedicated endpoints, SLAs, predictable latency, or production reliability",
      "Has high-volume inference, coding-agent, or internal developer-tool usage",
      "Mentions Claude Code, OSS migration, or closed-source provider replacement with scale pressure",
    ],
    negativeSignals: [
      "Only casual competitor mention",
      "One-off rate limit support issue without scale or production intent",
      "Generic coding-tool mention without company-level throughput or migration signal",
      "Vendor comparison with no current usage, buying motion, or capacity need",
    ],
    refreshCadence: "daily",
  },
];

export const segmentInputSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().min(8).max(600),
  status: z.enum(["active", "paused", "archived"]),
  audience: z.enum(["prospects", "customers", "both"]),
  detectionPrompt: z.string().trim().min(12).max(1200),
  searchQueries: z.array(z.string().trim().min(2).max(180)).min(1).max(12),
  positiveSignals: z.array(z.string().trim().min(2).max(180)).max(12),
  negativeSignals: z.array(z.string().trim().min(2).max(180)).max(12),
  refreshCadence: z.enum(["daily", "weekly", "manual"]),
});

export function buildProspectClassificationPrompt({
  segment,
  candidates,
}: {
  segment: Pick<Doc<"companySegments">, "title" | "description" | "detectionPrompt">;
  candidates: ProspectClassificationCandidate[];
}): string {
  const segmentSpecificRules = `Segment-specific rules for Provisioned throughput Prospects:
- Accept only when the evidence shows a credible provisioned-throughput sales motion: committed token/GPU volume, reserved capacity, dedicated endpoint purchase/evaluation, enterprise SLA/reliability requirement, production traffic at known scale, pricing/contracting for capacity, or an active POC that is clearly expected to become dedicated/provisioned.
- Strong examples: Prosus, Klarna, Torq, Motorq, HBK, and Higgsfield style evidence: deal size or workload scale plus what they use today plus what they asked Together for.
- Claude Code migration, coding-agent, and OSS migration evidence is not enough by itself. Accept only when it includes company-level scale, cost/spend pressure, production usage, capacity commitment, or explicit dedicated/provisioned endpoint discussion.
- Reject generic throughput or latency complaints, simple rate-limit increases, support outages, one-off dedicated endpoint errors, batch inference errors, generic model benchmarking, generic vendor evaluation, casual competitor mentions, and broad infrastructure conversations unless they include real buying motion or committed scale.
- Do not qualify a company just because it is a well-known AI company or appears in a search result.`;
  return `You are classifying customer/prospect evidence for an internal sales intelligence dashboard.

Segment:
- Title: ${segment.title}
- Description: ${segment.description}
- Detection prompt: ${segment.detectionPrompt}

Task:
For each candidate company, decide whether the evidence is strong enough for a sales/product person to review the company in this exact segment.

Output requirement:
- Return exactly one decision for every candidate.
- Do not return an empty decisions array when candidates are provided.
- Every decision.domain must exactly match one candidate.domain from the JSON.

Strict acceptance rules:
- Accept only if the evidence shows company-level PT intent with at least one of: concrete deal/workload size, committed or reserved capacity, dedicated endpoint buying/evaluation, production SLA/reliability requirement, high-volume token/GPU traffic, procurement/pricing for capacity, or migration driven by cost/scale.
- Reject generic keyword overlap, vendor name mentions, casual comparisons, unrelated support issues, or vague discussion without segment-specific intent.
- Reject candidates whose only evidence is a rate-limit increase, throughput improvement request, outage/downtime, unsupported model, deployment error, generic benchmarking, or a customer asking about Together generally.
- For closed-source to OSS migration segments, reject mere interest in Together/open-source models unless the evidence also mentions a closed-source provider such as Claude, Anthropic, OpenAI, Gemini, or an explicit replacement/migration/cost-reduction driver.
- Prefer precision over recall. It is better to return too few prospects than to include one weak or embarrassing false positive.
- Do not invent facts outside the evidence.
- Use only evidenceIndexes that materially support the decision.
- Slack channel messages are account context only. Use them to improve summary, currentState, blockers, nextSteps, scale, usage, spend, or urgency, but do not reference them in evidenceIndexes because evidenceIndexes only point to call/support evidence.
- Fit score should reflect quality of segment fit, not number of mentions: 90+ for explicit active buying/evaluation, 80-89 for strong concrete signal, 70-79 for plausible but not page-worthy signal, below 70 for rejection. Accepted page-worthy prospects should normally be 80+.
- Write the accepted decision like an account brief a sales/product leader can scan without opening the source.
- currentState must capture the current stack, provider/model, deployment setup, or usage context. Do not put "unknown" style scale statements here.
- scale must be the best concrete workload size available from evidence or Slack context. Prefer GPU count/range, token/request volume, throughput, or spend. Good examples: "24-40 GPUs", "700K requests/month; 120K input and 8K output tokens/request", "272M TPM with 20s E2E latency", "~$15K/month". If no concrete scale exists, return null. Never return vague negatives like "No workload size yet".
- extraDetails must contain only additional core facts not already covered by summary, currentState, scale, blockers, or nextSteps. Use concise bullet-style strings. Do not include raw source metadata such as ISSUE, Company, Domain, State, waiting_on_customer, or "Source detail". Do not include truncated fragments.
- outcome: set to "lost" only when the evidence shows the prospect explicitly and confidently decided NOT to use Together for this need — e.g. "decided to proceed with X", "going with X instead", "selected X over Together", "signed with X". When outcome is "lost", set lostToCompetitor to the competitor's name (e.g. "Fireworks") and lostReason to a short evidence-grounded reason (e.g. "better performance and token-based pricing at $33k/month"). Do not set outcome to "lost" for a single negative comment, a stalled conversation, or an undecided comparison.
- outcome: set to "won" only when the evidence shows Together was selected/signed as the provider for this need. Otherwise leave outcome as "active" (the default).
- competitorsConsidered should list any named competitor products/vendors the prospect is actively evaluating alongside Together (e.g. ["Nebius"], ["Fireworks", "Baseten"]), even if no decision has been made yet. Leave it empty if no competitor is named.
- summary must capture the intent in one direct sentence: migration goal, provisioned-capacity need, model/product fit, blocker, or business driver. Good examples: "Evaluating Kimi, GLM, and DeepSeek as open-source replacements to reduce LLM spend below $10K/month", "Needs faster throughput and is exploring dedicated endpoints to improve latency and token output".
- blockers should only include concrete blockers such as cost, rate limits, throughput, residency, procurement, latency, context length, SLA, or implementation gaps.
- nextSteps should be concrete account actions, not generic "follow up" language.
- In each decision, copy the candidate's domain exactly from the candidate JSON.

${segmentSpecificRules}

Candidates:
${JSON.stringify(candidates, null, 2)}`;
}

export function normalizeProspectDecision({
  decision,
  evidenceCount,
}: {
  decision: ProspectClassificationDecision;
  evidenceCount: number;
}): ProspectClassificationDecision {
  const evidenceIndexes = [...new Set(decision.evidenceIndexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < evidenceCount)
    .slice(0, 8);
  const outcome = decision.outcome ?? "active";
  return {
    ...decision,
    fitScore: Math.max(0, Math.min(100, Math.round(decision.fitScore))),
    stage: decision.stage.trim() || (decision.accepted ? "Qualified signal" : "Rejected"),
    summary: decision.summary.trim(),
    currentState: decision.currentState?.trim() || undefined,
    scale: decision.scale?.trim() || undefined,
    extraDetails: (decision.extraDetails ?? []).map((detail) => detail.trim()).filter(Boolean).slice(0, 6),
    blockers: decision.blockers.map((blocker) => blocker.trim()).filter(Boolean).slice(0, 6),
    nextSteps: decision.nextSteps.map((step) => step.trim()).filter(Boolean).slice(0, 6),
    evidenceIndexes,
    rejectionReason: decision.rejectionReason?.trim() || undefined,
    outcome,
    lostToCompetitor: outcome === "lost" ? (decision.lostToCompetitor?.trim() || undefined) : undefined,
    lostReason: outcome === "lost" ? (decision.lostReason?.trim() || undefined) : undefined,
    competitorsConsidered: [...new Set((decision.competitorsConsidered ?? []).map((competitor) => competitor.trim()).filter(Boolean))].slice(0, 5),
  };
}

export function parseProspectClassificationText({
  text,
}: {
  text: string;
}): ProspectClassificationOutput {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Prospect classifier returned empty output.");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const unfenced = fenced?.[1]?.trim() ?? trimmed;
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Prospect classifier did not return a JSON object.");
  }
  const jsonText = unfenced.slice(firstBrace, lastBrace + 1);
  const parsed = JSON.parse(jsonText) as unknown;
  return prospectClassificationOutputSchema.parse(parsed);
}

export function normalizeDomain({ value }: { value?: string | null }): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
    .replace(/[^a-z0-9.-]/g, "");
}

export function companyNameFromDomain({ domain }: { domain: string }): string {
  const root = domain.split(".")[0] ?? domain;
  return root
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || domain;
}

export function buildMembershipSummary({
  segment,
  companyName,
  evidence,
}: {
  segment: Pick<Doc<"companySegments">, "title">;
  companyName: string;
  evidence: EvidenceRef[];
}): string {
  const latest = evidence[0]?.snippet ?? "Recent calls or tickets match this segment.";
  return `${companyName} matched ${segment.title} based on ${evidence.length} source ${evidence.length === 1 ? "reference" : "references"}. Latest signal: ${latest}`;
}

export function inferConfidence({ evidenceCount }: { evidenceCount: number }): "low" | "medium" | "high" {
  if (evidenceCount >= 4) return "high";
  if (evidenceCount >= 2) return "medium";
  return "low";
}

export function inferFitScore({ evidenceCount, queryCount }: { evidenceCount: number; queryCount: number }): number {
  return Math.min(95, 45 + evidenceCount * 10 + Math.min(queryCount, 4) * 5);
}
