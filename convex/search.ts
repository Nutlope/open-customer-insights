import { v } from "convex/values";
import { action, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { PaginationResult } from "convex/server";
import { TOGETHER_EMBEDDING_MODEL, MAX_EMBED_CHARS } from "../lib/embedding/embed";
import { requireAuthenticatedClerkId } from "../lib/convex/auth";
import {
  type SearchResult,
  callToSearchResult,
  issueToSearchResult,
  chunkToSearchResult,
  metadataMatchScore,
  rankHybridChunks,
  toInternalSource,
  isInRange,
  getDateLowerBound,
  getDateUpperBound,
} from "../lib/convex/search";


type Chunk = Doc<"chunks">;
type Call = Doc<"calls">;
type PylonIssue = Doc<"pylonIssues">;

const TOGETHER_API_URL = "https://api.together.xyz/v1/embeddings";
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 200;
const MAX_SEARCH_OFFSET = 2000;
const MAX_VECTOR_CANDIDATES = 256;
const MAX_TEXT_CANDIDATES = 1000;
const MAX_METADATA_CANDIDATES = 5000;
const SEARCH_CANDIDATE_MULTIPLIER = 4;

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(TOGETHER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: TOGETHER_EMBEDDING_MODEL, input: text.slice(0, MAX_EMBED_CHARS) }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const data = await res.json() as { data: { embedding: number[] }[] };
  return data.data[0]!.embedding;
}

export const getChunksByEmbeddingIds = internalQuery({
  args: { ids: v.array(v.id("chunkEmbeddings")) },
  handler: async (ctx, { ids }) => {
    const results: (Doc<"chunks"> | null)[] = [];
    for (const id of ids) {
      const chunk = await ctx.db
        .query("chunks")
        .withIndex("by_embedding", (q) => q.eq("embeddingId", id))
        .unique();
      results.push(chunk);
    }
    return results;
  },
});

export const searchChunksByText = internalQuery({
  args: {
    query: v.string(),
    source: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { query, source, limit }) => {
    const internalSource = toInternalSource(source);
    const searchQuery = ctx.db
      .query("chunks")
      .withSearchIndex("by_text", (q) => {
        const searched = q.search("text", query);
        return internalSource ? searched.eq("dataSource", internalSource) : searched;
      });

    return searchQuery.take(limit);
  },
});

export const getCallsByGongIds = internalQuery({
  args: { gongIds: v.array(v.string()) },
  handler: async (ctx, { gongIds }) => {
    const results: (Doc<"calls"> | null)[] = [];
    for (const gongId of gongIds) {
      const call = await ctx.db
        .query("calls")
        .withIndex("by_gong_id", (q) => q.eq("gongId", gongId))
        .unique();
      results.push(call);
    }
    return results;
  },
});

export const getPylonIssuesByIds = internalQuery({
  args: { pylonIds: v.array(v.string()) },
  handler: async (ctx, { pylonIds }) => {
    const results: (Doc<"pylonIssues"> | null)[] = [];
    for (const pylonId of pylonIds) {
      const issue = await ctx.db
        .query("pylonIssues")
        .withIndex("by_pylon_id", (q) => q.eq("pylonId", pylonId))
        .unique();
      results.push(issue);
    }
    return results;
  },
});

export const getPylonChunksByIssueIds = internalQuery({
  args: {
    pylonIds: v.array(v.string()),
    limitPerIssue: v.optional(v.number()),
  },
  handler: async (ctx, { pylonIds, limitPerIssue }): Promise<{ sourceId: string; snippets: string[] }[]> => {
    const limit = limitPerIssue ?? 2;
    const results: { sourceId: string; snippets: string[] }[] = [];
    for (const pylonId of pylonIds) {
      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_source", (q) => q.eq("dataSource", "pylon").eq("sourceId", pylonId))
        .take(limit);
      results.push({
        sourceId: pylonId,
        snippets: chunks.map((chunk) => chunk.text),
      });
    }
    return results;
  },
});

export const getSourceContentByIds = internalQuery({
  args: {
    dataSource: v.union(v.literal("gong"), v.literal("pylon")),
    sourceIds: v.array(v.string()),
  },
  handler: async (ctx, { dataSource, sourceIds }): Promise<{ sourceId: string; text: string }[]> => {
    const results: { sourceId: string; text: string }[] = [];
    for (const sourceId of sourceIds) {
      const chunks = await ctx.db
        .query("chunks")
        .withIndex("by_source", (q) => q.eq("dataSource", dataSource).eq("sourceId", sourceId))
        .collect();
      results.push({
        sourceId,
        text: chunks
          .sort((a, b) => a.chunkId.localeCompare(b.chunkId))
          .map((chunk) => chunk.text)
          .join("\n"),
      });
    }
    return results;
  },
});

export const getCallsByDateRange = internalQuery({
  args: { from: v.optional(v.string()), to: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { from, to, limit }) => {
    const lower = getDateLowerBound({ date: from });
    const upper = getDateUpperBound({ date: to });
    const q = ctx.db.query("calls").withIndex("by_started", (idx) => {
      if (lower && upper.value) {
        return upper.inclusive
          ? idx.gte("started", lower).lte("started", upper.value)
          : idx.gte("started", lower).lt("started", upper.value);
      }
      if (lower) return idx.gte("started", lower);
      if (upper.value) return upper.inclusive ? idx.lte("started", upper.value) : idx.lt("started", upper.value);
      return idx;
    });
    return q.order("desc").take(limit ?? 20);
  },
});

export const getAllCallsByDateRange = internalQuery({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { from, to }) => {
    const lower = getDateLowerBound({ date: from });
    const upper = getDateUpperBound({ date: to });
    const q = ctx.db.query("calls").withIndex("by_started", (idx) => {
      if (lower && upper.value) {
        return upper.inclusive
          ? idx.gte("started", lower).lte("started", upper.value)
          : idx.gte("started", lower).lt("started", upper.value);
      }
      if (lower) return idx.gte("started", lower);
      if (upper.value) return upper.inclusive ? idx.lte("started", upper.value) : idx.lt("started", upper.value);
      return idx;
    });
    return q.order("desc").collect();
  },
});

export const getIssuesByDateRange = internalQuery({
  args: { from: v.optional(v.string()), to: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { from, to, limit }) => {
    const lower = getDateLowerBound({ date: from });
    const upper = getDateUpperBound({ date: to });
    const q = ctx.db.query("pylonIssues").withIndex("by_created", (idx) => {
      if (lower && upper.value) {
        return upper.inclusive
          ? idx.gte("createdAt", lower).lte("createdAt", upper.value)
          : idx.gte("createdAt", lower).lt("createdAt", upper.value);
      }
      if (lower) return idx.gte("createdAt", lower);
      if (upper.value) return upper.inclusive ? idx.lte("createdAt", upper.value) : idx.lt("createdAt", upper.value);
      return idx;
    });
    return q.order("desc").take(limit ?? 20);
  },
});

export const getCallMetadataMatches = internalQuery({
  args: {
    query: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { query, from, to, limit }): Promise<SearchResult[]> => {
    const calls = await ctx.db
      .query("calls")
      .withIndex("by_started", (q) => q)
      .order("desc")
      .take(MAX_METADATA_CANDIDATES);

    return calls
      .filter((call) => isInRange({ value: call.started, fromDate: from, toDate: to }))
      .map((call) => {
        const score = metadataMatchScore({
          query,
          fields: [
            call.title,
            call.companyDomain,
            call.brief,
            ...(call.keyPoints ?? []),
            ...call.parties.flatMap((party) => [party.name, party.emailAddress]),
          ],
        });
        return { call, score };
      })
      .filter(({ score }) => score > 0)
      .sort((first, second) => second.score - first.score || second.call.started.localeCompare(first.call.started))
      .slice(0, limit)
      .map(({ call, score }) => callToSearchResult(call, { score }));
  },
});

export const getIssueMetadataMatches = internalQuery({
  args: {
    query: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, { query, from, to, limit }): Promise<SearchResult[]> => {
    const issues = await ctx.db
      .query("pylonIssues")
      .withIndex("by_created", (q) => q)
      .order("desc")
      .take(MAX_METADATA_CANDIDATES);

    return issues
      .filter((issue) => isInRange({ value: issue.createdAt, fromDate: from, toDate: to }))
      .map((issue) => {
        const score = metadataMatchScore({
          query,
          fields: [
            issue.title,
            issue.companyName,
            issue.companyDomain,
            issue.requesterEmail,
            issue.assigneeEmail,
            issue.issueCategory,
            issue.priority,
            ...issue.tags,
          ],
        });
        return { issue, score };
      })
      .filter(({ score }) => score > 0)
      .sort((first, second) => second.score - first.score || second.issue.createdAt.localeCompare(first.issue.createdAt))
      .slice(0, limit)
      .map(({ issue, score }) => issueToSearchResult(issue, { score }));
  },
});

export const getAllIssuesByDateRange = internalQuery({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { from, to }) => {
    const lower = getDateLowerBound({ date: from });
    const upper = getDateUpperBound({ date: to });
    const q = ctx.db.query("pylonIssues").withIndex("by_created", (idx) => {
      if (lower && upper.value) {
        return upper.inclusive
          ? idx.gte("createdAt", lower).lte("createdAt", upper.value)
          : idx.gte("createdAt", lower).lt("createdAt", upper.value);
      }
      if (lower) return idx.gte("createdAt", lower);
      if (upper.value) return upper.inclusive ? idx.lte("createdAt", upper.value) : idx.lt("createdAt", upper.value);
      return idx;
    });
    return q.order("desc").collect();
  },
});

export const getCallsByDateRangePage = internalQuery({
  args: { from: v.optional(v.string()), to: v.optional(v.string()), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { from, to, cursor }): Promise<PaginationResult<Doc<"calls">>> => {
    const lower = getDateLowerBound({ date: from });
    const upper = getDateUpperBound({ date: to });
    const q = ctx.db.query("calls").withIndex("by_started", (idx) => {
      if (lower && upper.value) {
        return upper.inclusive
          ? idx.gte("started", lower).lte("started", upper.value)
          : idx.gte("started", lower).lt("started", upper.value);
      }
      if (lower) return idx.gte("started", lower);
      if (upper.value) return upper.inclusive ? idx.lte("started", upper.value) : idx.lt("started", upper.value);
      return idx;
    });
    return q.order("desc").paginate({ numItems: 500, cursor });
  },
});

export const getIssuesByDateRangePage = internalQuery({
  args: { from: v.optional(v.string()), to: v.optional(v.string()), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { from, to, cursor }): Promise<PaginationResult<Doc<"pylonIssues">>> => {
    const lower = getDateLowerBound({ date: from });
    const upper = getDateUpperBound({ date: to });
    const q = ctx.db.query("pylonIssues").withIndex("by_created", (idx) => {
      if (lower && upper.value) {
        return upper.inclusive
          ? idx.gte("createdAt", lower).lte("createdAt", upper.value)
          : idx.gte("createdAt", lower).lt("createdAt", upper.value);
      }
      if (lower) return idx.gte("createdAt", lower);
      if (upper.value) return upper.inclusive ? idx.lte("createdAt", upper.value) : idx.lt("createdAt", upper.value);
      return idx;
    });
    return q.order("desc").paginate({ numItems: 500, cursor });
  },
});

export const getPylonIssueIdsByDateRange = internalQuery({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    const lower = getDateLowerBound({ date: from }) ?? from;
    const upper = getDateUpperBound({ date: to });
    const issues = await ctx.db
      .query("pylonIssues")
      .withIndex("by_created", (idx) =>
        upper.inclusive
          ? idx.gte("createdAt", lower).lte("createdAt", upper.value ?? to)
          : idx.gte("createdAt", lower).lt("createdAt", upper.value ?? to)
      )
      .collect();
    return issues.map((i) => i.pylonId);
  },
});

export { type SearchResult };

export const searchChunks = action({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    query: v.optional(v.string()),
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SearchResult[]> => {
    const clerkId = await requireAuthenticatedClerkId({
      ctx,
      clerkId: args.clerkId,
      serverSecret: args.serverSecret,
    });
    const user = await ctx.runQuery(internal.users.getUserByClerkId, { clerkId });
    if (!user) throw new Error("Unauthorized");
    const { query, fromDate, toDate } = args;
    const internalSource = toInternalSource(args.source);
    const resultLimit = Math.min(Math.max(Math.floor(args.limit ?? DEFAULT_SEARCH_LIMIT), 1), MAX_SEARCH_LIMIT);
    const resultOffset = Math.min(Math.max(Math.floor(args.offset ?? 0), 0), MAX_SEARCH_OFFSET);

    if (!query) {
      const results: SearchResult[] = [];
      const fetchLimit = resultOffset + resultLimit;
      if (!internalSource || internalSource === "gong") {
        const calls = (await ctx.runQuery(internal.search.getCallsByDateRange, { from: fromDate, to: toDate, limit: fetchLimit })) as Call[];
        for (const call of calls) {
          results.push(callToSearchResult(call));
        }
      }
      if (!internalSource || internalSource === "pylon") {
        const issues = (await ctx.runQuery(internal.search.getIssuesByDateRange, { from: fromDate, to: toDate, limit: fetchLimit })) as PylonIssue[];
        for (const issue of issues) {
          results.push(issueToSearchResult(issue));
        }
      }
      return results
        .sort((a, b) => {
          const aDate = a.started ?? a.createdAt ?? "";
          const bDate = b.started ?? b.createdAt ?? "";
          return bDate.localeCompare(aDate);
        })
        .slice(resultOffset, resultOffset + resultLimit);
    }

    const candidatesNeeded = (resultOffset + resultLimit) * SEARCH_CANDIDATE_MULTIPLIER;
    const vectorTopK = Math.min(Math.max(candidatesNeeded, resultLimit), MAX_VECTOR_CANDIDATES);
    const textTopK = Math.min(Math.max(candidatesNeeded, resultLimit), MAX_TEXT_CANDIDATES);
    const metadataTopK = Math.min(Math.max(candidatesNeeded, resultLimit), 100);

    const [metadataCalls, metadataIssues, textChunks] = await Promise.all([
      !internalSource || internalSource === "gong"
        ? ctx.runQuery(internal.search.getCallMetadataMatches, {
            query,
            from: fromDate,
            to: toDate,
            limit: metadataTopK,
          }) as Promise<SearchResult[]>
        : Promise.resolve([]),
      !internalSource || internalSource === "pylon"
        ? ctx.runQuery(internal.search.getIssueMetadataMatches, {
            query,
            from: fromDate,
            to: toDate,
            limit: metadataTopK,
          }) as Promise<SearchResult[]>
        : Promise.resolve([]),
      ctx.runQuery(internal.search.searchChunksByText, {
        query,
        source: args.source,
        limit: textTopK,
      }) as Promise<Chunk[]>,
    ]);

    let vectorResults: Array<{ _id: Id<"chunkEmbeddings">; _score: number }> = [];
    try {
      const embedding = await embedQuery(query);
      vectorResults = await (
        internalSource
          ? ctx.vectorSearch("chunkEmbeddings", "by_embedding", {
              vector: embedding,
              limit: vectorTopK,
              filter: (q) => q.eq("dataSource", internalSource),
            })
          : ctx.vectorSearch("chunkEmbeddings", "by_embedding", {
              vector: embedding,
              limit: vectorTopK,
            })
      );
    } catch (error) {
      console.warn("[search] Embedding search failed; falling back to text and metadata search", error);
    }

    const rawChunks = (await ctx.runQuery(internal.search.getChunksByEmbeddingIds, {
      ids: vectorResults.map((r) => r._id),
    })) as (Chunk | null)[];

    const scoreMap = new Map(vectorResults.map((r) => [r._id.toString(), r._score]));

    const vectorChunks = rawChunks
      .filter((chunk): chunk is Chunk => chunk !== null)
      .map((chunk: Chunk) => ({
        chunk,
        vectorScore: chunk.embeddingId ? (scoreMap.get(chunk.embeddingId.toString()) ?? 0) : 0,
      }));

    const scored = rankHybridChunks({
      vectorChunks,
      textChunks,
      limit: vectorChunks.length + textChunks.length,
    });

    const gongIds = [...new Set(
      scored.filter(({ chunk }) => chunk.dataSource === "gong").map(({ chunk }) => chunk.sourceId)
    )];
    const pylonIds = [...new Set(
      scored.filter(({ chunk }) => chunk.dataSource === "pylon").map(({ chunk }) => chunk.sourceId)
    )];

    const [rawCalls, rawIssues] = await Promise.all([
      gongIds.length ? ctx.runQuery(internal.search.getCallsByGongIds, { gongIds }) : Promise.resolve([]),
      pylonIds.length ? ctx.runQuery(internal.search.getPylonIssuesByIds, { pylonIds }) : Promise.resolve([]),
    ]);

    const callMap = new Map(
      (rawCalls as (Call | null)[]).filter((c): c is Call => c !== null).map((c) => [c.gongId, c])
    );
    const issueMap = new Map(
      (rawIssues as (PylonIssue | null)[]).filter((i): i is PylonIssue => i !== null).map((i) => [i.pylonId, i])
    );

    const results: SearchResult[] = [...metadataCalls, ...metadataIssues];
    const seenSourceKeys = new Set<string>();
    for (const result of results) {
      seenSourceKeys.add(`${result.dataSource}:${result.sourceId}`);
    }
    for (const { chunk, score } of scored) {
      if (chunk.dataSource === "gong" && !isInRange({ value: callMap.get(chunk.sourceId)?.started ?? null, fromDate, toDate })) continue;
      if (chunk.dataSource === "pylon" && !isInRange({ value: issueMap.get(chunk.sourceId)?.createdAt ?? null, fromDate, toDate })) continue;
      const sourceKey = `${chunk.dataSource}:${chunk.sourceId}`;
      if (seenSourceKeys.has(sourceKey)) continue;
      seenSourceKeys.add(sourceKey);

      const result = chunkToSearchResult(chunk, score, callMap.get(chunk.sourceId), issueMap.get(chunk.sourceId));
      if (result) results.push(result);
      if (results.length >= resultOffset + resultLimit) break;
    }
    return results
      .sort((first, second) => {
        if (second.score !== first.score) return second.score - first.score;
        const firstDate = first.started ?? first.createdAt ?? "";
        const secondDate = second.started ?? second.createdAt ?? "";
        return secondDate.localeCompare(firstDate);
      })
      .slice(resultOffset, resultOffset + resultLimit);
  },
});

export const getItemDetails = query({
  args: {
    clerkId: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
    source: v.union(v.literal("call"), v.literal("support")),
    id: v.string(),
  },
  handler: async (ctx, { clerkId, serverSecret, source, id }): Promise<{ item: Call | PylonIssue | null; chunks: Chunk[] }> => {
    const authenticatedClerkId = await requireAuthenticatedClerkId({ ctx, clerkId, serverSecret });
    const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", authenticatedClerkId)).unique();
    if (!user) throw new Error("Unauthorized");
    const dataSource = source === "call" ? "gong" : "pylon";

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_source", (q) => q.eq("dataSource", dataSource).eq("sourceId", id))
      .collect();

    if (source === "call") {
      const call = await ctx.db
        .query("calls")
        .withIndex("by_gong_id", (q) => q.eq("gongId", id))
        .unique();
      return { item: call ?? null, chunks };
    } else {
      const issue = await ctx.db
        .query("pylonIssues")
        .withIndex("by_pylon_id", (q) => q.eq("pylonId", id))
        .unique();
      return { item: issue ?? null, chunks };
    }
  },
});
