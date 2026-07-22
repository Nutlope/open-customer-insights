import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { embedBatch, EMBED_BATCH } from "../lib/embedding/embed";
import { chunksAggregate } from "./aggregates";
import { hasTogetherCredentials } from "../lib/integrations";

const EMBED_CONCURRENCY = 3; // parallel Together API calls per runEmbedPending

export const getPendingChunks = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<Doc<"chunks">[]> => {
    const n = limit ?? 64;
    // Primary: explicit needsEmbedding flag — O(1) index lookup on a defined value
    const byFlag = await ctx.db
      .query("chunks")
      .withIndex("by_needs_embedding", (q) => q.eq("needsEmbedding", true))
      .take(n);
    if (byFlag.length > 0) return byFlag;
    // Fallback: old embeddingId index until migration backfills needsEmbedding on existing chunks
    return ctx.db
      .query("chunks")
      .withIndex("by_embedding", (q) => q.eq("embeddingId", undefined))
      .take(n);
  },
});

export const storeChunkEmbedding = internalMutation({
  args: {
    chunkId: v.id("chunks"),
    dataSource: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, { chunkId, dataSource, embedding }) => {
    const oldDoc = await ctx.db.get(chunkId);
    // Skip if chunk was re-ingested (new text, needsEmbedding reset) between when
    // the embed action fetched it and now — the old embedding would be for stale text.
    if (!oldDoc || oldDoc.needsEmbedding !== true) return;
    const embeddingId = await ctx.db.insert("chunkEmbeddings", { embedding, dataSource });
    await ctx.db.patch(chunkId, { embeddingId, needsEmbedding: undefined });
    const newDoc = await ctx.db.get(chunkId);
    await chunksAggregate.replace(ctx, oldDoc, newDoc!);
  },
});

export const runEmbedPending = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (!hasTogetherCredentials()) return 0;
    const pending = (await ctx.runQuery(internal.embed.getPendingChunks, { limit: 64 })) as Doc<"chunks">[];
    if (!pending.length) {
      console.log("[embed] no pending chunks");
      return 0;
    }
    console.log(`[embed] embedding ${pending.length} chunks`);

    // Split into batches of EMBED_BATCH, then fire up to EMBED_CONCURRENCY in parallel
    const batches: Doc<"chunks">[][] = [];
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      batches.push(pending.slice(i, i + EMBED_BATCH));
    }

    for (let i = 0; i < batches.length; i += EMBED_CONCURRENCY) {
      const concurrent = batches.slice(i, i + EMBED_CONCURRENCY);
      const results = await Promise.all(concurrent.map((b) => embedBatch(b.map((c) => c.text))));
      for (let j = 0; j < concurrent.length; j++) {
        for (let k = 0; k < concurrent[j]!.length; k++) {
          await ctx.runMutation(internal.embed.storeChunkEmbedding, {
            chunkId: concurrent[j]![k]!._id,
            dataSource: concurrent[j]![k]!.dataSource,
            embedding: results[j]![k]!,
          });
        }
      }
    }
    return pending.length;
  },
});

// One-time migration: backfills needsEmbedding:true on chunks that predate the field.
// Safe to re-run; returns number of chunks updated this batch (loop until 0).
export const migrateNeedsEmbedding = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const batch = (await ctx.runQuery(internal.embed.getPendingChunksLegacy, { limit: 200 })) as Doc<"chunks">[];
    for (const chunk of batch) {
      await ctx.runMutation(internal.embed.setNeedsEmbedding, { chunkId: chunk._id });
    }
    return batch.length;
  },
});

export const getPendingChunksLegacy = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<Doc<"chunks">[]> => {
    return ctx.db
      .query("chunks")
      .withIndex("by_embedding", (q) => q.eq("embeddingId", undefined))
      .filter((q) => q.eq(q.field("needsEmbedding"), undefined))
      .take(limit ?? 200);
  },
});

export const setNeedsEmbedding = internalMutation({
  args: { chunkId: v.id("chunks") },
  handler: async (ctx, { chunkId }) => {
    await ctx.db.patch(chunkId, { needsEmbedding: true });
  },
});

// Script entrypoint: processes one batch, returns count (loop externally).
export const embedAllPending = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    return ctx.runAction(internal.embed.runEmbedPending, {});
  },
});
