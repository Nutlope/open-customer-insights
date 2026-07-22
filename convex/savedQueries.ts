import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  getExistingCurrentUserId,
  getOrCreateCurrentUserId,
  titleFromQuery,
} from "../lib/convex/savedQueries";
import { summarizeSavedQueryUsage } from "../lib/convex/savedQueryUsage";
import { requireAdmin } from "../lib/convex/auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getExistingCurrentUserId({ ctx });
    if (!userId) return [];
    return await ctx.db
      .query("savedQueries")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const save = mutation({
  args: {
    query: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"savedQueries">> => {
    const userId = await getOrCreateCurrentUserId({ ctx });
    const trimmedQuery = args.query.replace(/\s+/g, " ").trim();
    if (!trimmedQuery) throw new Error("Query is empty");

    const title = args.title?.trim() || titleFromQuery({ query: trimmedQuery });
    const now = Date.now();
    const existing = await ctx.db
      .query("savedQueries")
      .withIndex("by_user_query", (q) => q.eq("userId", userId).eq("query", trimmedQuery))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("savedQueries", {
      userId,
      title,
      query: trimmedQuery,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const markRun = mutation({
  args: {
    savedQueryId: v.id("savedQueries"),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = await getOrCreateCurrentUserId({ ctx });
    const savedQuery = await ctx.db.get(args.savedQueryId);
    if (!savedQuery || savedQuery.userId !== userId) throw new Error("Saved query not found");
    const now = Date.now();
    await ctx.db.patch(args.savedQueryId, {
      lastRunAt: now,
      runCount: (savedQuery.runCount ?? (savedQuery.lastRunAt ? 1 : 0)) + 1,
      updatedAt: now,
    });
    await ctx.db.insert("savedQueryRuns", {
      userId,
      savedQueryId: args.savedQueryId,
      title: savedQuery.title,
      query: savedQuery.query,
      threadId: args.threadId,
      timestamp: now,
    });
  },
});

export const getAdminSummary = query({
  args: {
    userId: v.optional(v.string()),
    weekFilter: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin({ ctx });

    const [users, savedQueries, runs] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("savedQueries").collect(),
      ctx.db.query("savedQueryRuns").order("desc").take(args.limit ?? 10000),
    ]);

    return summarizeSavedQueryUsage({
      users,
      savedQueries,
      runs,
      userFilter: args.userId,
      weekFilter: args.weekFilter,
    });
  },
});

export const rename = mutation({
  args: {
    savedQueryId: v.id("savedQueries"),
    title: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = await getOrCreateCurrentUserId({ ctx });
    const savedQuery = await ctx.db.get(args.savedQueryId);
    if (!savedQuery || savedQuery.userId !== userId) throw new Error("Saved query not found");
    const title = args.title.trim();
    if (!title) throw new Error("Title is empty");
    await ctx.db.patch(args.savedQueryId, {
      title,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: {
    savedQueryId: v.id("savedQueries"),
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = await getOrCreateCurrentUserId({ ctx });
    const savedQuery = await ctx.db.get(args.savedQueryId);
    if (!savedQuery || savedQuery.userId !== userId) throw new Error("Saved query not found");
    await ctx.db.delete(args.savedQueryId);
  },
});
