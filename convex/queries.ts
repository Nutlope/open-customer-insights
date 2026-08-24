import { internalQuery, query } from "./_generated/server";
import { callsAggregate, issuesAggregate, chunksAggregate } from "./aggregates";
import { requireAuthenticated } from "../lib/convex/auth";

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticated({ ctx });
    const callsCount = await callsAggregate.count(ctx);
    const issuesCount = await issuesAggregate.count(ctx);
    const chunksTotal = await chunksAggregate.count(ctx);
    const chunksEmbedded = await chunksAggregate.sum(ctx);
    const [recentCalls, recentTickets] = await Promise.all([
      ctx.db.query("calls").withIndex("by_started").order("desc").take(5),
      ctx.db.query("pylonIssues").withIndex("by_created").order("desc").take(5),
    ]);
    return {
      callsCount,
      issuesCount,
      chunksTotal,
      chunksEmbedded,
      recentCalls: recentCalls.map((call) => ({
        title: call.title,
        date: call.started,
      })),
      recentTickets: recentTickets.map((ticket) => ({
        title: ticket.title,
        date: ticket.createdAt,
      })),
    };
  },
});

export const getStatsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const callsCount = await callsAggregate.count(ctx);
    const issuesCount = await issuesAggregate.count(ctx);
    const chunksTotal = await chunksAggregate.count(ctx);
    const chunksEmbedded = await chunksAggregate.sum(ctx);
    return { callsCount, issuesCount, chunksTotal, chunksEmbedded };
  },
});
