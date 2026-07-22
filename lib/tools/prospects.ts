import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { capToolOutput, type ToolOutputOptions } from "./output";

type CompanyProfile = Doc<"companyProfiles">;
type SegmentMembership = Doc<"companySegmentMemberships">;
type SegmentRun = Doc<"companySegmentRuns">;
type SegmentDashboard = Doc<"companySegments"> & {
  memberships: Array<SegmentMembership & { company: CompanyProfile | null }>;
  latestRun: SegmentRun | null;
};

type ProspectToolParams = {
  convex: ConvexHttpClient;
  serverSecret?: string;
  segmentSlug?: string;
  company?: string;
  limit?: number;
  outputOptions?: ToolOutputOptions;
};

export const LIST_PROSPECTS_TOOL_DESCRIPTION = `List prospect segment dashboard entries.
Returns qualified prospect companies, fit scores, reasons, workload size, evidence refs, and latest segment run metadata.
Use this for questions about Provisioned Throughput prospects, qualified accounts, prospect evidence, and sales intelligence segments.`;

export const listProspectsInputSchema = z.object({
  segmentSlug: z.string().optional().describe("Optional segment slug. Omit for all active prospect segments."),
  company: z.string().optional().describe("Optional company/domain filter, e.g. Sierra or sierra.ai"),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum companies to return, default 25, max 100"),
});

function sourceRefText({ membership }: { membership: SegmentMembership }): string {
  const refs = [...membership.evidenceRefs, ...(membership.manualEvidenceRefs ?? [])].slice(0, 6);
  if (refs.length === 0) return "Evidence: none";
  return `Evidence: ${refs.map((ref) => `${ref.source}:${ref.id}${ref.title ? ` (${ref.title})` : ""}${ref.date ? ` ${ref.date}` : ""}`).join("; ")}`;
}

function matchesCompany({ company, filter }: { company: CompanyProfile | null; filter?: string }): boolean {
  const normalized = filter?.trim().toLowerCase();
  if (!normalized) return true;
  return [company?.name, company?.domain]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

export async function listProspectsTool({
  convex,
  serverSecret,
  segmentSlug,
  company,
  limit,
  outputOptions,
}: ProspectToolParams): Promise<string> {
  const dashboards = await convex.query(api.prospects.getProspectDashboard, {
    segmentSlug,
    serverSecret,
  }) as SegmentDashboard[];

  if (dashboards.length === 0) return "No active prospect segments found.";

  const max = limit ?? 25;
  const sections = dashboards.map((segment) => {
    const memberships = segment.memberships
      .filter((membership) => matchesCompany({ company: membership.company, filter: company }))
      .sort((a, b) => b.fitScore - a.fitScore || b.lastSeenAt - a.lastSeenAt)
      .slice(0, max);

    if (memberships.length === 0) {
      return `Segment: ${segment.title}\nNo prospects matched the filters.`;
    }

    const latestRun = segment.latestRun
      ? `Latest run: ${new Date(segment.latestRun.completedAt).toISOString()} | new ${segment.latestRun.newCompanies} | updated ${segment.latestRun.updatedCompanies} | evidence ${segment.latestRun.evidenceCount}\nRun summary: ${segment.latestRun.summary}`
      : "Latest run: none";

    const rows = memberships.map((membership, index) => {
      const profile = membership.company;
      const name = profile?.name ?? profile?.domain ?? "Unknown company";
      const domain = profile?.domain ? ` (${profile.domain})` : "";
      const description = profile?.description ? `\nDescription: ${profile.description}` : "";
      const blockers = membership.blockers.length > 0 ? `\nBlockers: ${membership.blockers.join("; ")}` : "";
      const nextSteps = membership.nextSteps.length > 0 ? `\nNext steps: ${membership.nextSteps.join("; ")}` : "";
      return `${index + 1}. ${name}${domain}\nFit: ${membership.fitScore} | Confidence: ${membership.confidence} | Stage: ${membership.stage} | Last seen: ${new Date(membership.lastSeenAt).toISOString()}\nSummary: ${membership.summary}${description}${blockers}${nextSteps}\n${sourceRefText({ membership })}`;
    }).join("\n\n");

    return `Segment: ${segment.title} (${segment.slug})\n${segment.description}\n${latestRun}\n\n${rows}`;
  });

  return capToolOutput({
    text: sections.join("\n\n---\n\n"),
    label: "Prospects output",
    guidance: "Use a segment, company filter, or smaller limit.",
    outputOptions,
  });
}
