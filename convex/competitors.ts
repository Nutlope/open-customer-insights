import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { PaginationResult } from "convex/server";
import { COMPETITORS, detectCompetitorMentions, findMentionSnippet } from "../lib/competitors";
import { requireAuthenticatedClerkId } from "../lib/convex/auth";

// ── Cache TTLs (ms) ───────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

const CACHE_TTL_MS: Record<string, number> = {
  week: 15 * 60 * 1000, // 15 min
  month: 16 * HOUR_MS, // 16 hours
  quarter: 16 * HOUR_MS, // 16 hours
  halfyear: 16 * HOUR_MS, // 16 hours
  year: 16 * HOUR_MS, // 16 hours
};

// ── Internal queries ──────────────────────────────────────────────────────────

export const getChunkPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<PaginationResult<Doc<"chunks">>> => {
    return ctx.db.query("chunks").paginate({ numItems: 500, cursor });
  },
});

export const getChunkPageDesc = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<PaginationResult<Doc<"chunks">>> => {
    return ctx.db.query("chunks").order("desc").paginate({ numItems: 500, cursor });
  },
});

// Fetches all chunks for a batch of (dataSource, sourceId) pairs.
export const getChunksForSources = internalQuery({
  args: {
    sources: v.array(v.object({ dataSource: v.string(), sourceId: v.string() })),
  },
  handler: async (ctx, { sources }): Promise<Doc<"chunks">[]> => {
    const results: Doc<"chunks">[] = [];
    for (const { dataSource, sourceId } of sources) {
      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_source", (q) => q.eq("dataSource", dataSource).eq("sourceId", sourceId))
        .collect();
      results.push(...chunks);
    }
    return results;
  },
});

export const getChunksBySourceId = internalQuery({
  args: { dataSource: v.string(), sourceId: v.string() },
  handler: async (ctx, { dataSource, sourceId }): Promise<Doc<"chunks">[]> => {
    return ctx.db
      .query("chunks")
      .withIndex("by_source", (q) => q.eq("dataSource", dataSource).eq("sourceId", sourceId))
      .collect();
  },
});

const leaderboardRowValidator = v.object({
  name: v.string(),
  domain: v.string(),
  calls: v.number(),
  tickets: v.number(),
  total: v.number(),
  lastSeen: v.union(v.string(), v.null()),
});

export const getCachedLeaderboard = internalQuery({
  args: { range: v.string() },
  handler: async (ctx, { range }) => {
    return ctx.db
      .query("competitorLeaderboardCache")
      .withIndex("by_range", (q) => q.eq("range", range))
      .first();
  },
});

export const upsertCachedLeaderboard = internalMutation({
  args: { range: v.string(), rows: v.array(leaderboardRowValidator) },
  handler: async (ctx, { range, rows }) => {
    const existing = await ctx.db
      .query("competitorLeaderboardCache")
      .withIndex("by_range", (q) => q.eq("range", range))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { rows, computedAt: Date.now() });
    } else {
      await ctx.db.insert("competitorLeaderboardCache", { range, rows, computedAt: Date.now() });
    }
  },
});

// ── Internal mutations ────────────────────────────────────────────────────────

export const patchChunkCompetitorMentions = internalMutation({
  args: {
    chunkId: v.id("chunks"),
    competitorMentions: v.array(v.string()),
  },
  handler: async (ctx, { chunkId, competitorMentions }) => {
    await ctx.db.patch(chunkId, { competitorMentions });
  },
});

export const batchPatchChunkCompetitorMentions = internalMutation({
  args: {
    patches: v.array(v.object({
      chunkId: v.id("chunks"),
      competitorMentions: v.array(v.string()),
    })),
  },
  handler: async (ctx, { patches }) => {
    for (const { chunkId, competitorMentions } of patches) {
      await ctx.db.patch(chunkId, { competitorMentions });
    }
  },
});

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaderboardEntry = {
  name: string;
  domain: string;
  calls: number;
  tickets: number;
  total: number;
  lastSeen: string | null;
};

type MentionDetail = {
  sourceType: "call" | "ticket";
  id: string;
  title: string;
  date: string;
  companyDomain: string | undefined;
  snippets: string[];
};

// ── Public actions ────────────────────────────────────────────────────────────

export const getCompetitorLeaderboard = action({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    range: v.optional(v.string()), // "week" | "month" | "year" — enables cache
  },
  handler: async (ctx, { clerkId, serverSecret, from, to, range }): Promise<LeaderboardEntry[]> => {
    await requireAuthenticatedClerkId({ ctx, clerkId, serverSecret });

    // Return cached result if fresh enough
    if (range) {
      const cached = await ctx.runQuery(internal.competitors.getCachedLeaderboard, { range });
      const ttl = CACHE_TTL_MS[range] ?? 60 * 60 * 1000;
      if (cached && Date.now() - cached.computedAt < ttl) {
        return cached.rows;
      }
    }

    const counts: Record<string, { calls: number; tickets: number; lastSeen: string }> = {};
    const seenSources: Record<string, Set<string>> = {};

    const accumulate = (chunk: Doc<"chunks">) => {
      if (!chunk.competitorMentions?.length) return;
      const sourceKey = `${chunk.dataSource}:${chunk.sourceId}`;
      for (const name of chunk.competitorMentions) {
        counts[name] ??= { calls: 0, tickets: 0, lastSeen: "" };
        seenSources[name] ??= new Set();
        if (!seenSources[name].has(sourceKey)) {
          seenSources[name].add(sourceKey);
          if (chunk.dataSource === "gong") counts[name]!.calls++;
          else counts[name]!.tickets++;
        }
        const ts = chunk.ingestedAt ?? "";
        if (ts > counts[name]!.lastSeen) counts[name]!.lastSeen = ts;
      }
    };

    if (from) {
      // Paginate through calls and issues to avoid the 8192-item array limit
      const sources: { dataSource: string; sourceId: string }[] = [];

      let callCursor: string | null = null;
      let callsDone = false;
      while (!callsDone) {
        const page: PaginationResult<Doc<"calls">> = await ctx.runQuery(internal.search.getCallsByDateRangePage, { from, to, cursor: callCursor });
        for (const c of page.page) sources.push({ dataSource: "gong", sourceId: c.gongId });
        callCursor = page.continueCursor;
        callsDone = page.isDone;
      }

      let issueCursor: string | null = null;
      let issuesDone = false;
      while (!issuesDone) {
        const page: PaginationResult<Doc<"pylonIssues">> = await ctx.runQuery(internal.search.getIssuesByDateRangePage, { from, to, cursor: issueCursor });
        for (const i of page.page) sources.push({ dataSource: "pylon", sourceId: i.pylonId });
        issueCursor = page.continueCursor;
        issuesDone = page.isDone;
      }

      for (let i = 0; i < sources.length; i += 100) {
        const chunks = await ctx.runQuery(internal.competitors.getChunksForSources, {
          sources: sources.slice(i, i + 100),
        });
        for (const chunk of chunks) accumulate(chunk);
      }
    } else {
      let cursor: string | null = null;
      let isDone = false;
      while (!isDone) {
        const result: PaginationResult<Doc<"chunks">> = await ctx.runQuery(
          internal.competitors.getChunkPage,
          { cursor },
        );
        for (const chunk of result.page) accumulate(chunk);
        cursor = result.continueCursor;
        isDone = result.isDone;
      }
    }

    const domainMap = new Map(COMPETITORS.map((c) => [c.name, c.domain]));
    const rows = Object.entries(counts)
      .map(([name, { calls, tickets, lastSeen }]) => ({
        name,
        domain: domainMap.get(name) ?? "",
        calls,
        tickets,
        total: calls + tickets,
        lastSeen: lastSeen || null,
      }))
      .sort((a, b) => b.total - a.total);

    if (range) {
      await ctx.runMutation(internal.competitors.upsertCachedLeaderboard, { range, rows });
    }

    return rows;
  },
});

// Returns source-level mention details for one competitor, sorted newest-first.
// Date-scoped when `from` is provided; otherwise scans newest chunks first (capped at 20k).
export const getCompetitorMentionDetails = action({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    competitorName: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { clerkId, serverSecret, competitorName, from, to, limit: maxSources = 25 }): Promise<MentionDetail[]> => {
    await requireAuthenticatedClerkId({ ctx, clerkId, serverSecret });

    const sourceSnippets = new Map<string, { dataSource: string; sourceId: string; snippets: string[] }>();

    const addChunk = (chunk: Doc<"chunks">) => {
      if (!chunk.competitorMentions?.includes(competitorName)) return;
      const key = `${chunk.dataSource}:${chunk.sourceId}`;
      if (!sourceSnippets.has(key)) {
        sourceSnippets.set(key, { dataSource: chunk.dataSource, sourceId: chunk.sourceId, snippets: [] });
      }
      const entry = sourceSnippets.get(key)!;
      if (entry.snippets.length < 3) {
        entry.snippets.push(findMentionSnippet({ text: chunk.text, competitorName }));
      }
    };

    if (from) {
      const sources: { dataSource: string; sourceId: string }[] = [];

      let callCursor: string | null = null;
      let callsDone = false;
      while (!callsDone) {
        const page: PaginationResult<Doc<"calls">> = await ctx.runQuery(internal.search.getCallsByDateRangePage, { from, to, cursor: callCursor });
        for (const c of page.page) sources.push({ dataSource: "gong", sourceId: c.gongId });
        callCursor = page.continueCursor;
        callsDone = page.isDone;
      }

      let issueCursor: string | null = null;
      let issuesDone = false;
      while (!issuesDone) {
        const page: PaginationResult<Doc<"pylonIssues">> = await ctx.runQuery(internal.search.getIssuesByDateRangePage, { from, to, cursor: issueCursor });
        for (const i of page.page) sources.push({ dataSource: "pylon", sourceId: i.pylonId });
        issueCursor = page.continueCursor;
        issuesDone = page.isDone;
      }

      for (let i = 0; i < sources.length; i += 100) {
        const chunks = await ctx.runQuery(internal.competitors.getChunksForSources, {
          sources: sources.slice(i, i + 100),
        });
        for (const chunk of chunks) addChunk(chunk);
      }
    } else {
      // Scan newest-first, cap at 40 pages (20 k chunks) to avoid action timeout
      let cursor: string | null = null;
      let isDone = false;
      let pages = 0;
      while (!isDone && pages < 40) {
        const result: PaginationResult<Doc<"chunks">> = await ctx.runQuery(
          internal.competitors.getChunkPageDesc,
          { cursor },
        );
        for (const chunk of result.page) addChunk(chunk);
        cursor = result.continueCursor;
        isDone = result.isDone;
        pages++;
      }
    }

    const gongIds = [...sourceSnippets.values()]
      .filter((s) => s.dataSource === "gong")
      .map((s) => s.sourceId);
    const pylonIds = [...sourceSnippets.values()]
      .filter((s) => s.dataSource === "pylon")
      .map((s) => s.sourceId);

    const [rawCalls, rawIssues] = await Promise.all([
      gongIds.length
        ? ctx.runQuery(internal.search.getCallsByGongIds, { gongIds })
        : Promise.resolve([]),
      pylonIds.length
        ? ctx.runQuery(internal.search.getPylonIssuesByIds, { pylonIds })
        : Promise.resolve([]),
    ]);

    const callMap = new Map(
      (rawCalls as (Doc<"calls"> | null)[])
        .filter((c): c is Doc<"calls"> => c !== null)
        .map((c) => [c.gongId, c]),
    );
    const issueMap = new Map(
      (rawIssues as (Doc<"pylonIssues"> | null)[])
        .filter((i): i is Doc<"pylonIssues"> => i !== null)
        .map((i) => [i.pylonId, i]),
    );

    const results: MentionDetail[] = [];
    for (const { dataSource, sourceId, snippets } of sourceSnippets.values()) {
      if (dataSource === "gong") {
        const call = callMap.get(sourceId);
        if (!call) continue;
        results.push({
          sourceType: "call",
          id: sourceId,
          title: call.title,
          date: call.started,
          companyDomain: call.companyDomain,
          snippets,
        });
      } else {
        const issue = issueMap.get(sourceId);
        if (!issue) continue;
        results.push({
          sourceType: "ticket",
          id: sourceId,
          title: issue.title,
          date: issue.createdAt,
          companyDomain: issue.companyDomain,
          snippets,
        });
      }
    }

    return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxSources);
  },
});

// Script entrypoint for `npx convex run competitors:runCompetitorBackfill`.
// When from/to are provided, only processes chunks from sources in that date range.
// When omitted, does a full paginated scan of all untagged chunks.
export const runCompetitorBackfill = internalAction({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    force: v.optional(v.boolean()), // when true, re-tags already-tagged chunks (use after detection logic changes)
  },
  handler: async (ctx, { from, to, force = false }): Promise<{ processed: number; updated: number; sources?: number }> => {
    let processed = 0;
    let updated = 0;

    if (from) {
      const [calls, issues] = await Promise.all([
        ctx.runQuery(internal.search.getAllCallsByDateRange, { from, to }),
        ctx.runQuery(internal.search.getAllIssuesByDateRange, { from, to }),
      ]);

      type Source = { dataSource: "gong" | "pylon"; sourceId: string };
      const sources: Source[] = [
        ...(calls as Doc<"calls">[]).map((c) => ({ dataSource: "gong" as const, sourceId: c.gongId })),
        ...(issues as Doc<"pylonIssues">[]).map((i) => ({ dataSource: "pylon" as const, sourceId: i.pylonId })),
      ];

      const patches: Array<{ chunkId: Doc<"chunks">["_id"]; competitorMentions: string[] }> = [];
      for (const { dataSource, sourceId } of sources) {
        const chunks = await ctx.runQuery(internal.competitors.getChunksBySourceId, { dataSource, sourceId });
        for (const chunk of chunks) {
          processed++;
          if (!force && chunk.competitorMentions !== undefined) continue;
          patches.push({
            chunkId: chunk._id,
            competitorMentions: detectCompetitorMentions({ text: chunk.text }),
          });
          updated++;
          if (patches.length >= 500) {
            await ctx.runMutation(internal.competitors.batchPatchChunkCompetitorMentions, { patches: patches.splice(0) });
          }
        }
      }
      if (patches.length > 0) {
        await ctx.runMutation(internal.competitors.batchPatchChunkCompetitorMentions, { patches });
      }

      console.log(`[competitor-backfill] from=${from} to=${to ?? "now"} force=${force} sources=${sources.length} processed=${processed} updated=${updated}`);
      return { processed, updated, sources: sources.length };
    }

    let cursor: string | null = null;
    let isDone = false;

    while (!isDone) {
      const result: PaginationResult<Doc<"chunks">> = await ctx.runQuery(
        internal.competitors.getChunkPage,
        { cursor },
      );
      const patches: Array<{ chunkId: Doc<"chunks">["_id"]; competitorMentions: string[] }> = [];
      for (const chunk of result.page) {
        processed++;
        if (!force && chunk.competitorMentions !== undefined) continue;
        patches.push({
          chunkId: chunk._id,
          competitorMentions: detectCompetitorMentions({ text: chunk.text }),
        });
        updated++;
      }
      if (patches.length > 0) {
        await ctx.runMutation(internal.competitors.batchPatchChunkCompetitorMentions, { patches });
      }
      cursor = result.continueCursor;
      isDone = result.isDone;
    }

    console.log(`[competitor-backfill] full-scan force=${force} processed=${processed} updated=${updated}`);
    return { processed, updated };
  },
});
