import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { requireAuthenticated } from "../lib/convex/auth";
import {
  cleanPylonChunkText,
  compareTranscriptChunks,
  dedupePeople,
  getInternalPeopleForSpeakers,
  sourceUrl,
  stripSourcePrefix,
  type SourceDetailResult,
} from "../lib/convex/sourceDetails";

export const getSourceDetailData = internalQuery({
  args: {
    source: v.union(v.literal("call"), v.literal("support")),
    id: v.string(),
  },
  handler: async (ctx, args): Promise<SourceDetailResult | null> => {
    const cleanId = stripSourcePrefix({ id: args.id });
    if (args.source === "call") {
      const call = await ctx.db.query("calls").withIndex("by_gong_id", (q) => q.eq("gongId", cleanId)).unique();
      if (!call) return null;
      const chunks = await ctx.db.query("chunks").withIndex("by_source", (q) => q.eq("dataSource", "gong").eq("sourceId", cleanId)).collect();
      const sortedChunks = chunks.sort((a, b) => compareTranscriptChunks({ a, b }));
      const internalPeople = await getInternalPeopleForSpeakers({ ctx, speakerNames: sortedChunks.flatMap((chunk) => chunk.speakers ?? []) });
      return {
        source: "call",
        title: call.title,
        companyDomain: call.companyDomain,
        date: call.started,
        people: dedupePeople({ people: call.parties.map((party) => ({ name: party.name, email: party.emailAddress })), limit: 30 }),
        internalPeople,
        sections: [
          ...(call.brief ? [{ title: "Brief", text: call.brief }] : []),
          ...((call.keyPoints ?? []).length > 0 ? [{ title: "Key points", text: call.keyPoints!.join("\n") }] : []),
          ...sortedChunks.filter((chunk) => (chunk.speakers?.length ?? 0) > 0).map((chunk) => ({ title: chunk.speakers?.join(", ") || "Transcript", text: chunk.text })),
        ],
        url: sourceUrl({ source: "call", id: cleanId }),
      };
    }

    const issue = await ctx.db.query("pylonIssues").withIndex("by_pylon_id", (q) => q.eq("pylonId", cleanId)).unique();
    if (!issue) return null;
    const chunks = await ctx.db.query("chunks").withIndex("by_source", (q) => q.eq("dataSource", "pylon").eq("sourceId", cleanId)).collect();
    const sortedChunks = chunks.sort((a, b) => a.chunkId.localeCompare(b.chunkId));
    const internalPeople = await getInternalPeopleForSpeakers({ ctx, speakerNames: sortedChunks.flatMap((chunk) => chunk.authors ?? []) });
    const conversationText = sortedChunks.slice(0, 12).map((chunk) => cleanPylonChunkText({ text: chunk.text })).filter((text) => text.trim().length > 0).join("\n\n");
    const metadata = [
      issue.priority ? `Priority: ${issue.priority}` : null,
      issue.state ? `State: ${issue.state}` : null,
      issue.issueCategory ? `Category: ${issue.issueCategory}` : null,
    ].filter((line): line is string => line !== null).join("\n");
    return {
      source: "support",
      title: issue.title,
      companyDomain: issue.companyDomain,
      date: issue.createdAt,
      people: dedupePeople({ people: [{ email: issue.requesterEmail }, { email: issue.assigneeEmail }] }),
      internalPeople,
      sections: [
        metadata ? { title: "Ticket metadata", text: metadata } : null,
        conversationText.trim() ? { title: "Conversation", text: conversationText } : null,
      ].filter((section): section is { title: string; text: string } => section !== null),
      url: issue.link,
    };
  },
});

export const getSourceDetail = action({
  args: {
    source: v.union(v.literal("call"), v.literal("support")),
    id: v.string(),
  },
  handler: async (ctx, args): Promise<SourceDetailResult | null> => {
    await requireAuthenticated({ ctx });
    return await ctx.runQuery(internal.sourceDetails.getSourceDetailData, args);
  },
});
