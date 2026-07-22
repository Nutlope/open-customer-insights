import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { callsAggregate, chunksAggregate } from "./aggregates";
import { Doc } from "./_generated/dataModel";
import { ensureCompanyProfileForActivity, resolveCanonicalDomain } from "../lib/convex/companies";

export const insertCall = internalMutation({
  args: {
    gongId: v.string(),
    title: v.string(),
    started: v.string(),
    duration: v.number(),
    parties: v.array(v.object({ name: v.string(), emailAddress: v.optional(v.string()) })),
    companyDomain: v.optional(v.string()),
    brief: v.optional(v.string()),
    keyPoints: v.optional(v.array(v.string())),
    topics: v.optional(v.array(v.object({ name: v.string(), duration: v.number() }))),
    ingestedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const companyDomain = args.companyDomain == null
      ? args.companyDomain
      : await resolveCanonicalDomain({ db: ctx.db, domain: args.companyDomain });

    if (companyDomain != null) {
      const startedAt = Date.parse(args.started);
      if (!Number.isNaN(startedAt)) {
        const result = await ensureCompanyProfileForActivity({ ctx, domain: companyDomain, source: "gong", timestamp: startedAt });
        if (result.created && result.companyId) {
          await ctx.scheduler.runAfter(0, internal.enrichment.enrichCompanyDescriptionInternal, { companyId: result.companyId });
        }
      }
    }

    const existing = await ctx.db
      .query("calls")
      .withIndex("by_gong_id", (q) => q.eq("gongId", args.gongId))
      .unique();
    if (existing) {
      const patch: Partial<Doc<"calls">> = {
        title: args.title,
        started: args.started,
        duration: args.duration,
        ingestedAt: args.ingestedAt,
      };
      if (args.parties && args.parties.length) patch.parties = args.parties;
      if (companyDomain != null) patch.companyDomain = companyDomain;
      if (args.brief != null) patch.brief = args.brief;
      if (args.keyPoints != null) patch.keyPoints = args.keyPoints;
      if (args.topics != null) patch.topics = args.topics;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    const id = await ctx.db.insert("calls", { ...args, companyDomain });
    const doc = await ctx.db.get(id);
    await callsAggregate.insertIfDoesNotExist(ctx, doc!);
    return id;
  },
});

export const deleteAllGongData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const BATCH = 100;
    const calls = await ctx.db.query("calls").take(BATCH);
    for (const call of calls) {
      await callsAggregate.deleteIfExists(ctx, call);
      await ctx.db.delete(call._id);
    }

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_source", (q) => q.eq("dataSource", "gong"))
      .take(BATCH);
    for (const chunk of chunks) {
      if (chunk.embeddingId) await ctx.db.delete(chunk.embeddingId);
      await chunksAggregate.deleteIfExists(ctx, chunk);
      await ctx.db.delete(chunk._id);
    }

    const deletedThisBatch = calls.length + chunks.length;
    console.log(`[reset] deleted ${calls.length} calls, ${chunks.length} gong chunks (${deletedThisBatch} this batch)`);
    return deletedThisBatch;
  },
});

export const backfillCallAggregates = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("calls").paginate({ cursor, numItems: 200 });
    for (const doc of page.page) await callsAggregate.insertIfDoesNotExist(ctx, doc);
    console.log(`[backfill] calls=${page.page.length} done=${page.isDone}`);
    return { done: page.isDone, cursor: page.continueCursor };
  },
});
