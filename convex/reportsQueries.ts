import { v } from "convex/values";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireAuthenticated } from "../lib/convex/auth";
import type { ReportType } from "../lib/convex/reports";

const reportTypeValidator = v.literal("daily");

async function queryLatestByTypePeriod({
  ctx,
  type,
  periodStart,
}: {
  ctx: QueryCtx;
  type: ReportType;
  periodStart: string;
}) {
  const reports = await ctx.db
    .query("reports")
    .withIndex("by_type_period", (q) => q.eq("type", type).eq("periodStart", periodStart))
    .collect();
  return reports.sort((a, b) => b.generatedAt - a.generatedAt)[0] ?? null;
}

async function deduplicateAndFilterReports({
  ctx,
  type,
  from,
  to,
}: {
  ctx: QueryCtx;
  type?: ReportType;
  from?: string;
  to?: string;
}) {
  const fromDate = from ?? "0000-01-01";
  const toDate = to ?? "9999-12-31";
  const all = await ctx.db.query("reports").collect();
  const latestByPeriod = new Map<string, (typeof all)[number]>();
  for (const report of all) {
    const key = `${report.type}:${report.periodStart}`;
    const existing = latestByPeriod.get(key);
    if (!existing || report.generatedAt > existing.generatedAt) {
      latestByPeriod.set(key, report);
    }
  }
  return [...latestByPeriod.values()]
    .filter((r) => {
      if (type && r.type !== type) return false;
      if (r.periodStart < fromDate) return false;
      if (r.periodEnd > toDate) return false;
      return true;
    })
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart));
}

export const getReportByPeriod = query({
  args: {
    type: reportTypeValidator,
    periodStart: v.string(),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    return queryLatestByTypePeriod({ ctx, type: args.type, periodStart: args.periodStart });
  },
});

export const listReports = query({
  args: {
    type: v.optional(reportTypeValidator),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    return deduplicateAndFilterReports({ ctx, type: args.type, from: args.from, to: args.to });
  },
});

export const getLatestReports = query({
  args: {
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    const daily = await ctx.db
      .query("reports")
      .withIndex("by_generated")
      .order("desc")
      .filter((q) => q.eq(q.field("type"), "daily"))
      .first();
    return { daily: daily ?? null };
  },
});

export const getRecentReports = query({
  args: {
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuthenticated({ ctx, serverSecret: args.serverSecret });
    const d = new Date();
    d.setDate(d.getDate() - 14);
    const cutoff = d.toISOString().slice(0, 10);
    return await ctx.db
      .query("reports")
      .withIndex("by_generated")
      .order("desc")
      .filter((q) => q.gte(q.field("periodStart"), cutoff))
      .take(5);
  },
});

export const getReportByPeriodInternal = internalQuery({
  args: {
    type: reportTypeValidator,
    periodStart: v.string(),
  },
  handler: async (ctx, args) => {
    return queryLatestByTypePeriod({ ctx, type: args.type, periodStart: args.periodStart });
  },
});

export const listReportsInternal = internalQuery({
  args: {
    type: v.optional(reportTypeValidator),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return deduplicateAndFilterReports({ ctx, type: args.type, from: args.from, to: args.to });
  },
});

export const deleteAllReports = internalMutation({
  handler: async (ctx) => {
    const all = await ctx.db.query("reports").collect();
    await Promise.all(all.map((r) => ctx.db.delete(r._id)));
    return all.length;
  },
});

export const deleteReportsByTypeRange = internalMutation({
  args: {
    type: reportTypeValidator,
    from: v.string(),
    to: v.string(),
  },
  handler: async (ctx, args) => {
    const reports = await ctx.db.query("reports").collect();
    const matchingReports = reports.filter((report) => {
      if (report.type !== args.type) return false;
      if (report.periodStart < args.from) return false;
      if (report.periodStart > args.to) return false;
      return true;
    });

    const reportIds = new Set(matchingReports.map((report) => report._id));
    const insights = await ctx.db.query("dailyInsights").collect();
    const matchingInsights = insights.filter((insight) => reportIds.has(insight.reportId));

    await Promise.all([
      ...matchingInsights.map((insight) => ctx.db.delete(insight._id)),
      ...matchingReports.map((report) => ctx.db.delete(report._id)),
    ]);

    return {
      reportsDeleted: matchingReports.length,
      insightsDeleted: matchingInsights.length,
    };
  },
});

export const insertReport = internalMutation({
  args: {
    type: reportTypeValidator,
    periodStart: v.string(),
    periodEnd: v.string(),
    callCount: v.number(),
    ticketCount: v.number(),
    summary: v.string(),
    sentiment: v.object({
      positive: v.float64(),
      negative: v.float64(),
      neutral: v.float64(),
    }),
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
  handler: async (ctx, args) => {
    return await ctx.db.insert("reports", {
      ...args,
      generatedAt: Date.now(),
    });
  },
});
