import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { capToolOutput, type ToolOutputOptions } from "./output";

type DailyInsight = Doc<"dailyInsights">;
type DailyReportToolItem = {
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

type DailyInsightStatus = DailyInsight["status"];

type DailyReportsToolParams = {
  convex: ConvexHttpClient;
  serverSecret?: string;
  from?: string;
  to?: string;
  limit?: number;
  status?: DailyInsightStatus;
  company?: string;
  outputOptions?: ToolOutputOptions;
};

export const LIST_DAILY_INSIGHTS_TOOL_DESCRIPTION = `List daily customer insight reports.
Returns compact daily report summaries with source-backed daily insights, companies, sentiment, status, and source refs.
Use this for questions about daily insights, recent customer feedback digests, today's/yesterday's report, or daily executive summaries.

from/to: ISO dates such as "2026-06-01". Both are optional.
status: review, posted, or dismissed. Dismissed items are only returned for admins in the web app.`;

export const listDailyInsightsInputSchema = z.object({
  from: z.string().optional().describe("Optional ISO date start, e.g. 2026-06-01"),
  to: z.string().optional().describe("Optional ISO date end, e.g. 2026-06-07"),
  limit: z.number().int().min(1).max(60).optional().describe("Maximum daily reports to inspect, default 14, max 60"),
  status: z.enum(["review", "posted", "dismissed"]).optional().describe("Optional insight workflow status filter"),
  company: z.string().optional().describe("Optional company/domain text filter, e.g. Decagon or decagon.ai"),
});

function parseDailyDescription({ description }: { description: string }): string {
  const match = description.match(/(?:^|\n)What I Learned:\s*([\s\S]+)$/i);
  return (match?.[1] ?? description).replace(/\s+/g, " ").trim();
}

function sourceRefsText({ insight }: { insight: DailyInsight }): string {
  const refs = insight.sourceRefs ?? [];
  if (refs.length === 0) return "";
  return `\nSources: ${refs.map((ref) => `${ref.source}:${ref.id}${ref.title ? ` (${ref.title})` : ""}`).join("; ")}`;
}

function matchesCompany({ insight, company }: { insight: DailyInsight; company?: string }): boolean {
  const normalized = company?.trim().toLowerCase();
  if (!normalized) return true;
  return [insight.company, insight.companyDomain]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

export async function listDailyInsightsTool({
  convex,
  serverSecret,
  from,
  to,
  limit,
  status,
  company,
  outputOptions,
}: DailyReportsToolParams): Promise<string> {
  const reports = await convex.query(api.dailyInsights.listDailyReports, {
    limit: limit ?? 14,
    includeDismissed: status === "dismissed",
    serverSecret,
  }) as DailyReportToolItem[];

  const filtered = reports
    .filter((report) => {
      if (from && report.periodStart < from) return false;
      if (to && report.periodEnd > to) return false;
      return true;
    })
    .map((report) => ({
      ...report,
      insights: report.insights.filter((insight) => {
        if (status && insight.status !== status) return false;
        return matchesCompany({ insight, company });
      }),
    }))
    .filter((report) => report.insights.length > 0);

  if (filtered.length === 0) return "No daily insights found for those filters.";

  const output = filtered.map((report) => {
    const date = `${report.periodStart} to ${report.periodEnd}`;
    const sentiment = `sentiment +${report.sentiment.positive}/-${report.sentiment.negative}/=${report.sentiment.neutral}`;
    const insights = report.insights.map((insight, index) => {
      const companyLabel = insight.company ?? insight.companyDomain ?? "Unknown customer";
      const learned = parseDailyDescription({ description: insight.description });
      return `${index + 1}. ${insight.title}\nCompany: ${companyLabel}\nStatus: ${insight.status} | Sentiment: ${insight.sentiment}\n${learned}${sourceRefsText({ insight })}`;
    }).join("\n\n");
    return `Daily report ${date} (${report.callCount} calls, ${report.ticketCount} tickets, ${sentiment})\nSummary: ${report.summary}\n\n${insights}`;
  }).join("\n\n---\n\n");
  return capToolOutput({
    text: output,
    label: "Daily insights output",
    guidance: "Use a narrower date range, status, company, or smaller limit.",
    outputOptions,
  });
}
