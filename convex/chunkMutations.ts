import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { chunksAggregate } from "./aggregates";
import { detectCompetitorMentions } from "../lib/competitors";
import { stringArraysEqual } from "../lib/convex/chunks";

const chunkTextArgs = {
  dataSource: v.string(),
  sourceId: v.string(),
  chunkId: v.string(),
  text: v.string(),
  companyDomain: v.optional(v.string()),
  ingestedAt: v.optional(v.string()),
  startSec: v.optional(v.number()),
  endSec: v.optional(v.number()),
  speakers: v.optional(v.array(v.string())),
  internalSpeakers: v.optional(v.array(v.string())),
  externalSpeakers: v.optional(v.array(v.string())),
  authors: v.optional(v.array(v.string())),
};

export const upsertChunkText = internalMutation({
  args: chunkTextArgs,
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("chunks")
      .withIndex("by_source_chunk", (q) =>
        q.eq("dataSource", args.dataSource).eq("sourceId", args.sourceId).eq("chunkId", args.chunkId)
      )
      .take(2);
    const existing = matches[0];
    if (matches.length > 1) console.warn(`[chunks] duplicate rows exist for ${args.dataSource} ${args.sourceId} ${args.chunkId}; patching first match`);

    const competitorMentions = detectCompetitorMentions({ text: args.text });

    if (existing) {
      if (existing.text === args.text) {
        // Text-unchanged branch: the chunk content (and therefore its
        // embedding) is still valid, so we do NOT delete the embedding, do
        // NOT clear `embeddingId`, and do NOT set `needsEmbedding`. This is
        // what makes the gong re-import a metadata-only backfill instead of
        // a re-embed storm.
        //
        // Gong-only: a re-import may carry new affiliation metadata
        // (internalSpeakers/externalSpeakers) or refreshed speakers/domain.
        // Patch only the metadata fields that differ. Pylon chunks never
        // carry affiliation fields, so pylon stays byte-identical and its
        // `ingestedAt` is left untouched (preserving its GC cadence).
        if (args.dataSource === "gong") {
          const patch: Record<string, unknown> = {};
          if (!stringArraysEqual({ a: existing.speakers, b: args.speakers })) {
            patch.speakers = args.speakers;
          }
          if (!stringArraysEqual({ a: existing.internalSpeakers, b: args.internalSpeakers })) {
            patch.internalSpeakers = args.internalSpeakers;
          }
          if (!stringArraysEqual({ a: existing.externalSpeakers, b: args.externalSpeakers })) {
            patch.externalSpeakers = args.externalSpeakers;
          }
          if (existing.companyDomain !== args.companyDomain) {
            patch.companyDomain = args.companyDomain;
          }
          if (existing.ingestedAt !== args.ingestedAt) {
            patch.ingestedAt = args.ingestedAt;
          }
          if (Object.keys(patch).length) {
            await ctx.db.patch(existing._id, patch);
          }
        }
        return existing._id;
      }
      if (existing.embeddingId) await ctx.db.delete(existing.embeddingId);
      const oldDoc = existing;
      await ctx.db.patch(existing._id, {
        text: args.text,
        startSec: args.startSec,
        endSec: args.endSec,
        speakers: args.speakers,
        authors: args.authors,
        companyDomain: args.companyDomain,
        ingestedAt: args.ingestedAt,
        internalSpeakers: args.internalSpeakers,
        externalSpeakers: args.externalSpeakers,
        embeddingId: undefined,
        needsEmbedding: true,
        competitorMentions,
      });
      const newDoc = await ctx.db.get(existing._id);
      await chunksAggregate.replace(ctx, oldDoc, newDoc!);
      return existing._id;
    }

    const id = await ctx.db.insert("chunks", { ...args, needsEmbedding: true, competitorMentions });
    const doc = await ctx.db.get(id);
    await chunksAggregate.insertIfDoesNotExist(ctx, doc!);
    return id;
  },
});

export const deleteOtherChunks = internalMutation({
  args: {
    dataSource: v.string(),
    sourceId: v.string(),
    currentIngestedAt: v.string(),
  },
  handler: async (ctx, { dataSource, sourceId, currentIngestedAt }) => {
    const BATCH = 25;
    const stale = await ctx.db
      .query("chunks")
      .withIndex("by_source_ingested", (q) =>
        q.eq("dataSource", dataSource).eq("sourceId", sourceId).lt("ingestedAt", currentIngestedAt)
      )
      .take(BATCH);

    for (const chunk of stale) {
      if (chunk.embeddingId) await ctx.db.delete(chunk.embeddingId);
      await chunksAggregate.delete(ctx, chunk);
      await ctx.db.delete(chunk._id);
    }
    if (stale.length) {
      console.log(`[cleanup] removed ${stale.length} stale chunks for ${dataSource} ${sourceId}`);
    }
    return stale.length;
  },
});

export const clearAllEmbeddings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const BATCH = 100;

    const embeddings = await ctx.db.query("chunkEmbeddings").take(BATCH);
    for (const e of embeddings) await ctx.db.delete(e._id);

    const chunks = await ctx.db.query("chunks").take(BATCH);
    let clearedRefs = 0;
    for (const chunk of chunks) {
      if (chunk.embeddingId) {
        await ctx.db.patch(chunk._id, { embeddingId: undefined });
        const updated = await ctx.db.get(chunk._id);
        await chunksAggregate.replace(ctx, chunk, updated!);
        clearedRefs++;
      }
    }

    return embeddings.length + clearedRefs;
  },
});

export const backfillChunkAggregates = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("chunks").paginate({ cursor, numItems: 50 });
    for (const doc of page.page) await chunksAggregate.insertIfDoesNotExist(ctx, doc);
    console.log(`[backfill] chunks=${page.page.length} done=${page.isDone}`);
    return { done: page.isDone, cursor: page.continueCursor };
  },
});
