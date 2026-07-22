import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { issuesAggregate, chunksAggregate } from "./aggregates";
import { detectCompetitorMentions } from "../lib/competitors";
import { ensureCompanyProfileForActivity, resolveCanonicalDomain } from "../lib/convex/companies";

const pylonIssueArgs = {
  pylonId: v.string(),
  number: v.number(),
  title: v.string(),
  state: v.string(),
  source: v.string(),
  tags: v.array(v.string()),
  accountId: v.optional(v.string()),
  companyName: v.optional(v.string()),
  companyDomain: v.optional(v.string()),
  issueCategory: v.optional(v.string()),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  requesterId: v.optional(v.string()),
  requesterEmail: v.optional(v.string()),
  assigneeId: v.optional(v.string()),
  assigneeEmail: v.optional(v.string()),
  teamId: v.optional(v.string()),
  link: v.optional(v.string()),
  latestMessageTime: v.optional(v.string()),
  firstResponseTime: v.optional(v.string()),
  resolutionTime: v.optional(v.string()),
  customerPortalVisible: v.optional(v.boolean()),
  createdAt: v.string(),
  updatedAt: v.string(),
  ingestedAt: v.string(),
};

const pylonSqliteImportChunkArgs = {
  chunkId: v.string(),
  text: v.string(),
  authors: v.array(v.string()),
};

export const insertPylonIssue = internalMutation({
  args: pylonIssueArgs,
  handler: async (ctx, args) => {
    const companyDomain = args.companyDomain == null
      ? args.companyDomain
      : await resolveCanonicalDomain({ db: ctx.db, domain: args.companyDomain });

    if (companyDomain != null) {
      const createdAt = Date.parse(args.createdAt);
      if (!Number.isNaN(createdAt)) {
        const result = await ensureCompanyProfileForActivity({ ctx, domain: companyDomain, name: args.companyName, source: "pylon", timestamp: createdAt });
        if (result.created && result.companyId) {
          await ctx.scheduler.runAfter(0, internal.enrichment.enrichCompanyDescriptionInternal, { companyId: result.companyId });
        }
      }
    }

    const matches = await ctx.db
      .query("pylonIssues")
      .withIndex("by_pylon_id", (q) => q.eq("pylonId", args.pylonId))
      .take(2);
    const existing = matches[0];
    if (matches.length > 1) console.warn(`[pylon] duplicate pylonIssues rows exist for ${args.pylonId}; patching first match`);
    if (existing) {
      await ctx.db.patch(existing._id, {
        number: args.number,
        title: args.title,
        state: args.state,
        source: args.source,
        tags: args.tags,
        accountId: args.accountId,
        companyName: args.companyName,
        companyDomain,
        issueCategory: args.issueCategory,
        priority: args.priority,
        type: args.type,
        requesterId: args.requesterId,
        requesterEmail: args.requesterEmail,
        assigneeId: args.assigneeId,
        assigneeEmail: args.assigneeEmail,
        teamId: args.teamId,
        link: args.link,
        latestMessageTime: args.latestMessageTime,
        firstResponseTime: args.firstResponseTime,
        resolutionTime: args.resolutionTime,
        customerPortalVisible: args.customerPortalVisible,
        createdAt: args.createdAt,
        updatedAt: args.updatedAt,
        ingestedAt: args.ingestedAt,
      });
      return existing._id;
    }
    const id = await ctx.db.insert("pylonIssues", { ...args, companyDomain });
    const doc = await ctx.db.get(id);
    await issuesAggregate.insertIfDoesNotExist(ctx, doc!);
    return id;
  },
});

export const updatePylonIssueState = internalMutation({
  args: {
    pylonId: v.string(),
    state: v.string(),
    priority: v.optional(v.string()),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pylonIssues")
      .withIndex("by_pylon_id", (q) => q.eq("pylonId", args.pylonId))
      .unique();
    if (!existing) return;
    if (args.updatedAt <= existing.updatedAt) return;
    await ctx.db.patch(existing._id, {
      state: args.state,
      priority: args.priority,
      updatedAt: args.updatedAt,
    });
  },
});

export const importPylonSqliteBatch = internalMutation({
  args: {
    items: v.array(v.object({ issue: v.object(pylonIssueArgs), chunks: v.array(v.object(pylonSqliteImportChunkArgs)) })),
  },
  handler: async (ctx, { items }): Promise<{ importedIssues: number; importedChunks: number }> => {
    let importedIssues = 0;
    let importedChunks = 0;

    for (const item of items) {
      const companyDomain = item.issue.companyDomain == null
        ? item.issue.companyDomain
        : await resolveCanonicalDomain({ db: ctx.db, domain: item.issue.companyDomain });

      if (companyDomain != null) {
        const createdAt = Date.parse(item.issue.createdAt);
        if (!Number.isNaN(createdAt)) {
          await ensureCompanyProfileForActivity({ ctx, domain: companyDomain, name: item.issue.companyName, source: "pylon", timestamp: createdAt });
        }
      }

      const matches = await ctx.db
        .query("pylonIssues")
        .withIndex("by_pylon_id", (q) => q.eq("pylonId", item.issue.pylonId))
        .take(2);
      const existingIssue = matches[0];
      if (matches.length > 1) {
        console.warn(`[pylon] duplicate pylonIssues rows exist for ${item.issue.pylonId}; patching first match`);
      }

      if (existingIssue) {
        await ctx.db.patch(existingIssue._id, {
          number: item.issue.number,
          title: item.issue.title,
          state: item.issue.state,
          source: item.issue.source,
          tags: item.issue.tags,
          accountId: item.issue.accountId,
          companyName: item.issue.companyName,
          companyDomain,
          issueCategory: item.issue.issueCategory,
          priority: item.issue.priority,
          type: item.issue.type,
          requesterId: item.issue.requesterId,
          requesterEmail: item.issue.requesterEmail,
          assigneeId: item.issue.assigneeId,
          assigneeEmail: item.issue.assigneeEmail,
          teamId: item.issue.teamId,
          link: item.issue.link,
          latestMessageTime: item.issue.latestMessageTime,
          firstResponseTime: item.issue.firstResponseTime,
          resolutionTime: item.issue.resolutionTime,
          customerPortalVisible: item.issue.customerPortalVisible,
          createdAt: item.issue.createdAt,
          updatedAt: item.issue.updatedAt,
          ingestedAt: item.issue.ingestedAt,
        });
      } else {
        const id = await ctx.db.insert("pylonIssues", { ...item.issue, companyDomain });
        const doc = await ctx.db.get(id);
        await issuesAggregate.insertIfDoesNotExist(ctx, doc!);
      }
      importedIssues++;

      for (const chunk of item.chunks) {
        const chunkMatches = await ctx.db
          .query("chunks")
          .withIndex("by_source_chunk", (q) =>
            q.eq("dataSource", "pylon").eq("sourceId", item.issue.pylonId).eq("chunkId", chunk.chunkId)
          )
          .take(2);
        const existingChunk = chunkMatches[0];
        if (chunkMatches.length > 1) {
          console.warn(`[chunks] duplicate rows exist for pylon ${item.issue.pylonId} ${chunk.chunkId}; patching first match`);
        }

        const chunkCompetitorMentions = detectCompetitorMentions({ text: chunk.text });

        if (existingChunk) {
          if (existingChunk.text === chunk.text) continue;
          if (existingChunk.embeddingId) await ctx.db.delete(existingChunk.embeddingId);
          const oldDoc = existingChunk;
          await ctx.db.patch(existingChunk._id, {
            text: chunk.text,
            companyDomain,
            ingestedAt: item.issue.ingestedAt,
            authors: chunk.authors,
            embeddingId: undefined,
            needsEmbedding: true,
            competitorMentions: chunkCompetitorMentions,
          });
          const newDoc = await ctx.db.get(existingChunk._id);
          await chunksAggregate.replace(ctx, oldDoc, newDoc!);
        } else {
          const id = await ctx.db.insert("chunks", {
            dataSource: "pylon",
            sourceId: item.issue.pylonId,
            chunkId: chunk.chunkId,
            text: chunk.text,
            companyDomain,
            ingestedAt: item.issue.ingestedAt,
            authors: chunk.authors,
            needsEmbedding: true,
            competitorMentions: chunkCompetitorMentions,
          });
          const doc = await ctx.db.get(id);
          await chunksAggregate.insertIfDoesNotExist(ctx, doc!);
        }
        importedChunks++;
      }

      const stale = await ctx.db
        .query("chunks")
        .withIndex("by_source_ingested", (q) =>
          q.eq("dataSource", "pylon").eq("sourceId", item.issue.pylonId).lt("ingestedAt", item.issue.ingestedAt)
        )
        .take(100);
      for (const chunk of stale) {
        if (chunk.embeddingId) await ctx.db.delete(chunk.embeddingId);
        await chunksAggregate.delete(ctx, chunk);
        await ctx.db.delete(chunk._id);
      }
    }

    return { importedIssues, importedChunks };
  },
});

export const deleteAllPylonData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const BATCH = 25;
    const issues = await ctx.db.query("pylonIssues").take(BATCH);
    for (const issue of issues) {
      await issuesAggregate.deleteIfExists(ctx, issue);
      await ctx.db.delete(issue._id);
    }

    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_source", (q) => q.eq("dataSource", "pylon"))
      .take(BATCH);
    for (const chunk of chunks) {
      if (chunk.embeddingId) await ctx.db.delete(chunk.embeddingId);
      await chunksAggregate.deleteIfExists(ctx, chunk);
      await ctx.db.delete(chunk._id);
    }

    const deletedThisBatch = issues.length + chunks.length;
    console.log(`[reset] deleted ${issues.length} pylon issues, ${chunks.length} pylon chunks (${deletedThisBatch} this batch)`);
    return deletedThisBatch;
  },
});

export const backfillIssueAggregates = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("pylonIssues").paginate({ cursor, numItems: 200 });
    for (const doc of page.page) await issuesAggregate.insertIfDoesNotExist(ctx, doc);
    console.log(`[backfill] issues=${page.page.length} done=${page.isDone}`);
    return { done: page.isDone, cursor: page.continueCursor };
  },
});
