import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { rateLimiter } from "./rateLimits";
import type { FunctionArgs } from "convex/server";
import {
  fetchExternalCallIds,
  fetchCallsExtensive,
  fetchTranscripts,
  storeGongCallTexts,
} from "../lib/gong/api";
import {
  fetchPylonIssues,
  storePylonIssueTexts,
  PYLON_WINDOW_MS,
} from "../lib/pylon/api";
import type { PylonIssue } from "../lib/embedding/pylon/text";
import { hasGongCredentials, hasPylonCredentials } from "../lib/integrations";

const INGEST_LOOKBACK_MS = 5 * 60 * 60 * 1000;

// ── Gong internal action ────────────────────────────────────────────────────

export const runGongIngest = internalAction({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!hasGongCredentials()) return;
    const now = new Date();
    const to = args.to ?? now.toISOString();
    const from = args.from ?? new Date(now.getTime() - INGEST_LOOKBACK_MS).toISOString();

    const rateLimit = async () => { await rateLimiter.limit(ctx, "gongApi"); };

    const externalIds = await fetchExternalCallIds(from, to, rateLimit);
    if (!externalIds.length) return;

    const allCalls = await fetchCallsExtensive(externalIds, rateLimit);
    const txList = await fetchTranscripts(allCalls.map((c) => c.metaData.id), rateLimit);
    const txMap = new Map(txList.map((t) => [t.callId, t.transcript]));

    const db = {
      insertCall: (args: FunctionArgs<typeof internal.callMutations.insertCall>) => ctx.runMutation(internal.callMutations.insertCall, args),
      upsertChunkText: (args: FunctionArgs<typeof internal.chunkMutations.upsertChunkText>) => ctx.runMutation(internal.chunkMutations.upsertChunkText, args),
      deleteOtherChunks: (args: FunctionArgs<typeof internal.chunkMutations.deleteOtherChunks>) => ctx.runMutation(internal.chunkMutations.deleteOtherChunks, args),
    };

    await storeGongCallTexts(allCalls, txMap, db, now.toISOString());
  },
});

// ── Pylon internal action ────────────────────────────────────────────────────

export const runPylonIngest = internalAction({
  args: { from: v.optional(v.string()), to: v.optional(v.string()), maxIssues: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ processed: number; remaining: number }> => {
    if (!hasPylonCredentials()) return { processed: 0, remaining: 0 };
    const now = new Date();
    const to = new Date(args.to ?? now.toISOString());
    const from = new Date(args.from ?? new Date(now.getTime() - INGEST_LOOKBACK_MS).toISOString());
    const maxIssues = args.maxIssues ?? 30;

    const rateLimit = async () => { await rateLimiter.limit(ctx, "pylonApi"); };

    const db = {
      insertPylonIssue: (args: FunctionArgs<typeof internal.pylonMutations.insertPylonIssue>) => ctx.runMutation(internal.pylonMutations.insertPylonIssue, args),
      upsertChunkText: (args: FunctionArgs<typeof internal.chunkMutations.upsertChunkText>) => ctx.runMutation(internal.chunkMutations.upsertChunkText, args),
      deleteOtherChunks: (args: FunctionArgs<typeof internal.chunkMutations.deleteOtherChunks>) => ctx.runMutation(internal.chunkMutations.deleteOtherChunks, args),
    };

    const existingIssues: string[] = await ctx.runQuery(internal.search.getPylonIssueIdsByDateRange, { from: from.toISOString(), to: to.toISOString() });
    const existingPylonIds: Set<string> = new Set(existingIssues);

    const allIssues: PylonIssue[] = [];

    let windowEnd = to;
    while (windowEnd > from) {
      const windowStart = new Date(Math.max(windowEnd.getTime() - PYLON_WINDOW_MS, from.getTime()));
      const issues = await fetchPylonIssues({ from: windowStart.toISOString(), to: windowEnd.toISOString(), rateLimit });
      allIssues.push(...issues);
      windowEnd = windowStart;
    }

    const newIssues: PylonIssue[] = allIssues.filter((i) => !existingPylonIds.has(i.id));
    const batch = newIssues.slice(0, maxIssues);

    console.log(`[pylon] ${allIssues.length} fetched, ${existingPylonIds.size} existing, ${newIssues.length} new, processing ${batch.length}`);

    const result = await storePylonIssueTexts({ issues: batch, db, ingestedAt: now.toISOString(), rateLimit });
    const remaining: number = newIssues.length - batch.length;
    if (remaining > 0) {
      console.log(`[pylon] ${remaining} issues remaining for this range`);
    }
    return { processed: result.processed, remaining };
  },
});

// ── Pylon state sync ────────────────────────────────────────────────────────

export const runPylonStateSync = internalAction({
  args: { lookbackDays: v.optional(v.number()), from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!hasPylonCredentials()) return { checked: 0 };
    const now = new Date();
    const to = new Date(args.to ?? now.toISOString());
    const from = new Date(args.from ?? new Date(to.getTime() - (args.lookbackDays ?? 30) * 86_400_000).toISOString());
    const rateLimit = async () => { await rateLimiter.limit(ctx, "pylonApi"); };

    const issues = await fetchPylonIssues({
      from: from.toISOString(),
      to: to.toISOString(),
      rateLimit,
    });

    let updated = 0;
    for (const issue of issues) {
      await ctx.runMutation(internal.pylonMutations.updatePylonIssueState, {
        pylonId: issue.id,
        state: issue.state,
        priority: issue.custom_fields?.priority?.value ?? undefined,
        updatedAt: issue.updated_at,
      });
      updated++;
    }

    console.log(`[pylon-sync] checked ${issues.length} issues, updated state for ${updated}`);
    return { checked: issues.length };
  },
});

// ── Pylon historical rotating sync ───────────────────────────────────────────
// Cycles through the full history (everything older than 30 days) one 10-day
// window per run, ensuring old non-closed tickets eventually get refreshed too.

const PYLON_HISTORY_START_MS = new Date("2025-11-11T00:00:00Z").getTime();
const HISTORY_WINDOW_MS = 10 * 86_400_000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export const runPylonHistoricalRotatingSync = internalAction({
  args: { windowIndex: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!hasPylonCredentials()) return { checked: 0 };
    const now = new Date();
    const trailingCutoff = new Date(now.getTime() - 30 * 86_400_000);
    const totalMs = trailingCutoff.getTime() - PYLON_HISTORY_START_MS;
    if (totalMs <= 0) return { checked: 0 };

    const numWindows = Math.ceil(totalMs / HISTORY_WINDOW_MS);
    const idx = args.windowIndex ?? (Math.floor(now.getTime() / TWELVE_HOURS_MS) % numWindows);
    const from = new Date(PYLON_HISTORY_START_MS + idx * HISTORY_WINDOW_MS);
    const to = new Date(Math.min(from.getTime() + HISTORY_WINDOW_MS, trailingCutoff.getTime()));

    const rateLimit = async () => { await rateLimiter.limit(ctx, "pylonApi"); };
    const issues = await fetchPylonIssues({ from: from.toISOString(), to: to.toISOString(), rateLimit });

    for (const issue of issues) {
      await ctx.runMutation(internal.pylonMutations.updatePylonIssueState, {
        pylonId: issue.id,
        state: issue.state,
        priority: issue.custom_fields?.priority?.value ?? undefined,
        updatedAt: issue.updated_at,
      });
    }

    console.log(`[pylon-history-sync] window ${idx + 1}/${numWindows} (${from.toISOString().slice(0, 10)}→${to.toISOString().slice(0, 10)}): checked ${issues.length}`);
    return { checked: issues.length, windowIndex: idx, numWindows };
  },
});

// ── Public actions for scripts ───────────────────────────────────────────────

export const importGongRange = internalAction({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    await ctx.runAction(internal.ingest.runGongIngest, { from, to });
  },
});

export const importPylonRange = internalAction({
  args: { from: v.string(), to: v.string(), maxIssues: v.optional(v.number()) },
  handler: async (ctx, { from, to, maxIssues }): Promise<{ processed: number; remaining: number }> => {
    return await ctx.runAction(internal.ingest.runPylonIngest, { from, to, maxIssues });
  },
});
