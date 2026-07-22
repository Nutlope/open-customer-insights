import { v } from "convex/values";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  buildDailyPromptData,
  buildPrompt,
  computeDailyDataRange,
  computePeriod,
  isFailedReport,
  mapRawToReportOutput,
  normalizeReportOutput,
  reportOutputSchema,
  type ReportData,
  type ReportOutput,
  type ReportType,
  type SourceContentData,
} from "../lib/convex/reports";
import { hasTogetherCredentials } from "../lib/integrations";

const togetherai = createOpenAICompatible({
  name: "togetherai",
  apiKey: process.env.TOGETHER_API_KEY,
  baseURL: "https://api.together.xyz/v1",
  supportsStructuredOutputs: true,
});

const REPORT_MODELS = [
  "moonshotai/Kimi-K2.6",
  "deepseek-ai/DeepSeek-V4-Pro",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
] as const;

type StoredReport = ReportOutput & {
  _id: Id<"reports">;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  callCount: number;
  ticketCount: number;
};

type ReportPeriodArgs = {
  type: ReportType;
  periodStart: string;
};

type DateRangeArgs = {
  from?: string;
  to?: string;
};

type ExistingReportArgs = {
  existing: Doc<"reports"> | null;
  force?: boolean;
  periodEnd: string;
};

const getReportByPeriodRef = makeFunctionReference<
  "query",
  ReportPeriodArgs,
  Doc<"reports"> | null
>("reportsQueries:getReportByPeriodInternal");

const insertReportRef = makeFunctionReference<
  "mutation",
  Omit<Doc<"reports">, "_id" | "_creationTime" | "generatedAt">,
  Id<"reports">
>("reportsQueries:insertReport");

const getAllCallsByDateRangeRef = makeFunctionReference(
  "search:getAllCallsByDateRange",
) as unknown as FunctionReference<
  "query",
  "internal",
  DateRangeArgs,
  Doc<"calls">[]
>;

const getAllIssuesByDateRangeRef = makeFunctionReference(
  "search:getAllIssuesByDateRange",
) as unknown as FunctionReference<
  "query",
  "internal",
  DateRangeArgs,
  Doc<"pylonIssues">[]
>;

const getSourceContentByIdsRef = makeFunctionReference(
  "search:getSourceContentByIds",
) as unknown as FunctionReference<
  "query",
  "internal",
  {
    dataSource: "gong" | "pylon";
    sourceIds: string[];
  },
  SourceContentData[]
>;

function shouldReuseExistingReport({
  existing,
  force,
  periodEnd,
}: ExistingReportArgs): boolean {
  return (
    !force &&
    existing !== null &&
    !isFailedReport(existing) &&
    existing.periodEnd === periodEnd
  );
}

async function ensureDailyInsightsMaterialized({
  ctx,
  report,
}: {
  ctx: ActionCtx;
  report: Doc<"reports">;
}): Promise<void> {
  if (report.type !== "daily") return;
  const existing = await ctx.runQuery(internal.dailyInsights.listInsightsForPeriod, {
    from: report.periodStart,
    to: report.periodEnd,
  });
  if (existing.length > 0) return;
  await ctx.runMutation(internal.dailyInsights.materializeReportInsights, {
    reportId: report._id,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    generatedAt: report.generatedAt,
    highlights: report.highlights,
  });
}

async function generateReportOutput({ prompt }: { prompt: string }): Promise<ReportOutput> {
  let lastError: Error | null = null;
  for (const model of REPORT_MODELS) {
    try {
      const { output } = await generateText({
        model: togetherai(model),
        output: Output.object({ schema: reportOutputSchema }),
        prompt,
      });
      return mapRawToReportOutput({ raw: output });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("All models failed to generate report");
}

async function gatherData({
  ctx,
  type,
  periodStart,
  periodEnd,
}: {
  ctx: ActionCtx;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
}): Promise<ReportData | null> {
  const dataRange = computeDailyDataRange({ periodStart, periodEnd });
  const [calls, tickets] = await Promise.all([
    ctx.runQuery(getAllCallsByDateRangeRef, dataRange),
    ctx.runQuery(getAllIssuesByDateRangeRef, dataRange),
  ]);
  const [callContent, ticketContent] = await Promise.all([
    calls.length > 0
      ? ctx.runQuery(getSourceContentByIdsRef, {
          dataSource: "gong",
          sourceIds: calls.map((call) => call.gongId),
        })
      : Promise.resolve([]),
    tickets.length > 0
      ? ctx.runQuery(getSourceContentByIdsRef, {
          dataSource: "pylon",
          sourceIds: tickets.map((ticket) => ticket.pylonId),
        })
      : Promise.resolve([]),
  ]);
  return buildDailyPromptData({ calls, tickets, callContent, ticketContent });
}

async function insertGeneratedReport(
  ctx: ActionCtx,
  type: ReportType,
  periodStart: string,
  periodEnd: string,
  data: ReportData,
  output: ReportOutput,
): Promise<StoredReport> {
  const id = await ctx.runMutation(insertReportRef, {
    type,
    periodStart,
    periodEnd,
    callCount: data.callCount,
    ticketCount: data.ticketCount,
    summary: output.summary,
    sentiment: output.sentiment,
    highlights: output.highlights,
  });
  const generatedAt = Date.now();

  if (type === "daily") {
    await ctx.runMutation(internal.dailyInsights.materializeReportInsights, {
      reportId: id,
      periodStart,
      periodEnd,
      generatedAt,
      highlights: output.highlights,
    });
  }

  return {
    _id: id,
    type,
    periodStart,
    periodEnd,
    callCount: data.callCount,
    ticketCount: data.ticketCount,
    ...output,
  };
}

async function resolveOrGenerate({
  ctx,
  type,
  periodStart,
  periodEnd,
  force,
}: {
  ctx: ActionCtx;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  force?: boolean;
}): Promise<Doc<"reports"> | StoredReport | null> {
  const existing: Doc<"reports"> | null = await ctx.runQuery(getReportByPeriodRef, { type, periodStart });
  if (shouldReuseExistingReport({ existing, force, periodEnd })) {
    if (existing) await ensureDailyInsightsMaterialized({ ctx, report: existing });
    return existing;
  }
  const data = await gatherData({ ctx, type, periodStart, periodEnd });
  if (!data) return null;
  return await generateAndStore(ctx, type, periodStart, periodEnd, data);
}

async function generateAndStore(
  ctx: ActionCtx,
  type: ReportType,
  periodStart: string,
  periodEnd: string,
  data: ReportData,
): Promise<StoredReport> {
  try {
    const output = normalizeReportOutput({
      type,
      output: await generateReportOutput({
        prompt: buildPrompt({ type, periodStart, periodEnd, promptData: data.promptData }),
      }),
    });
    return await insertGeneratedReport(ctx, type, periodStart, periodEnd, data, output);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return await insertGeneratedReport(ctx, type, periodStart, periodEnd, data, {
      summary: `**${type.charAt(0).toUpperCase() + type.slice(1)} report ${periodStart} to ${periodEnd}**\n\n${data.callCount} calls, ${data.ticketCount} tickets analyzed.\n\n*Report generation failed. Please try again.*`,
      sentiment: { positive: 0, negative: 0, neutral: 100 },
      highlights: [
        {
          title: "Generation failed",
          description: `Error: ${message.slice(0, 200)}`,
          sentiment: "neutral",
        },
      ],
    });
  }
}

export const generateReport = internalAction({
  args: {
    type: v.literal("daily"),
  },
  handler: async (ctx, args): Promise<Doc<"reports"> | StoredReport | null> => {
    if (!hasTogetherCredentials()) return null;
    const { periodStart, periodEnd } = computePeriod(args.type);
    return resolveOrGenerate({ ctx, type: args.type, periodStart, periodEnd });
  },
});

export const generateReportPublic = internalAction({
  args: {
    type: v.literal("daily"),
    periodStart: v.optional(v.string()),
    periodEnd: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<"reports"> | StoredReport | null> => {
    const { periodStart, periodEnd } =
      args.periodStart && args.periodEnd
        ? { periodStart: args.periodStart, periodEnd: args.periodEnd }
        : computePeriod(args.type);
    return resolveOrGenerate({ ctx, type: args.type, periodStart, periodEnd, force: args.force });
  },
});

export const doGenerateForRange = internalAction({
  args: {
    type: v.literal("daily"),
    periodStart: v.string(),
    periodEnd: v.string(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<"reports"> | StoredReport | null> => {
    return resolveOrGenerate({
      ctx,
      type: args.type,
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      force: args.force,
    });
  },
});
