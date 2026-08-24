import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { callsAggregate, chunksAggregate, issuesAggregate } from "./aggregates";
import { buildDemoCompetitorRows, buildDemoSeedData, DEMO_PREFIX } from "../lib/convex/seedData";
import { clearDemoRows } from "../lib/convex/seed";

export const clearDemoData = internalMutation({
  args: {},
  handler: async (ctx) => await clearDemoRows({ ctx }),
});

export const seedDemoData = internalMutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }) => {
    const [existingCalls, existingIssues, existingCompanies] = await Promise.all([
      ctx.db.query("calls").collect(),
      ctx.db.query("pylonIssues").collect(),
      ctx.db.query("companyProfiles").collect(),
    ]);
    const hasNonDemoData = existingCalls.some((call) => !call.gongId.startsWith(DEMO_PREFIX))
      || existingIssues.some((issue) => !issue.pylonId.startsWith(DEMO_PREFIX))
      || existingCompanies.some((company) => !company.domain.endsWith(".example"));
    if (hasNonDemoData && !force) {
      throw new Error("Refusing to seed a database that already contains non-demo data. Pass {\"force\":true} to add the demo rows without deleting existing data.");
    }

    await clearDemoRows({ ctx });
    const now = Date.now();
    const data = buildDemoSeedData({ now });
    const companyIds = new Map<string, Id<"companyProfiles">>();
    for (const company of data.companies) {
      const companyCalls = data.calls.filter((call) => call.companyDomain === company.domain).sort((a, b) => b.started.localeCompare(a.started));
      const companyTickets = data.tickets.filter((ticket) => ticket.companyDomain === company.domain).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latestActivity = [
        ...companyCalls.map((call) => Date.parse(call.started)),
        ...companyTickets.map((ticket) => Date.parse(ticket.createdAt)),
      ].sort((a, b) => b - a)[0] ?? now;
      const id = await ctx.db.insert("companyProfiles", {
        ...company,
        website: `https://${company.domain}`,
        sources: ["gong", "pylon", "slack"],
        lastActivityAt: latestActivity,
        revenueCategories: company.lifetimeRevenue ? ["inference"] : undefined,
        createdAt: now - 90 * 86_400_000,
        updatedAt: now,
      });
      companyIds.set(company.domain, id);
      await ctx.db.insert("companyTimeline", {
        companyId: id,
        type: "ai_reflection",
        date: latestActivity,
        content: `${company.name} has recent product feedback across calls and support. Follow up on the most recent blocker before the next account review.`,
        riskScore: company.status === "former_customer" ? 82 : company.status === "prospect" ? 48 : 24,
        riskReason: company.status === "former_customer" ? "Historical reliability concerns" : "Open product follow-up",
        weekStart: new Date(now - 7 * 86_400_000).toISOString().slice(0, 10),
        detectedCompetitors: company.domain === "acme-robotics.example" ? ["Fireworks", "Groq"] : undefined,
        createdAt: now,
      });
      await ctx.db.insert("companyTimeline", {
        companyId: id,
        type: "manual_note",
        date: latestActivity - 3_600_000,
        content: `Demo account note: review “${companyTickets[0]?.title ?? "the latest support request"}” and follow up on ${companyCalls[0]?.brief ?? "the current adoption plan"}`,
        authorEmail: "success@example.com",
        createdAt: now - 3_600_000,
      });
    }

    for (const call of data.calls) {
      const id = await ctx.db.insert("calls", {
        gongId: call.gongId,
        title: call.title,
        started: call.started,
        duration: call.duration,
        parties: call.parties,
        companyDomain: call.companyDomain,
        brief: call.brief,
        keyPoints: call.keyPoints,
        topics: [{ name: "Product feedback", duration: Math.round(call.duration * 0.6) }],
        ingestedAt: new Date(now).toISOString(),
      });
      const doc = await ctx.db.get(id);
      if (doc) await callsAggregate.insertIfDoesNotExist(ctx, doc);
      const chunkId = `${call.gongId}-0`;
      const chunkDocId = await ctx.db.insert("chunks", {
        dataSource: "gong",
        sourceId: call.gongId,
        chunkId,
        text: call.transcript,
        companyDomain: call.companyDomain,
        ingestedAt: new Date(now).toISOString(),
        startSec: 0,
        endSec: call.duration,
        speakers: call.parties.map((party) => party.name),
        internalSpeakers: call.parties.filter((party) => party.emailAddress?.endsWith("@example.com")).map((party) => party.name),
        externalSpeakers: call.parties.filter((party) => !party.emailAddress?.endsWith("@example.com")).map((party) => party.name),
        needsEmbedding: true,
        competitorMentions: call.competitorMentions ?? [],
      });
      const chunkDoc = await ctx.db.get(chunkDocId);
      if (chunkDoc) await chunksAggregate.insertIfDoesNotExist(ctx, chunkDoc);
    }

    for (const ticket of data.tickets) {
      const id = await ctx.db.insert("pylonIssues", {
        pylonId: ticket.pylonId,
        number: ticket.number,
        title: ticket.title,
        state: ticket.state,
        source: "email",
        tags: ["demo", "customer-feedback"],
        companyName: ticket.companyName,
        companyDomain: ticket.companyDomain,
        issueCategory: "Product feedback",
        priority: ticket.priority,
        requesterEmail: ticket.requesterEmail,
        assigneeEmail: "support@example.com",
        customerPortalVisible: true,
        createdAt: ticket.createdAt,
        updatedAt: ticket.createdAt,
        ingestedAt: new Date(now).toISOString(),
      });
      const doc = await ctx.db.get(id);
      if (doc) await issuesAggregate.insertIfDoesNotExist(ctx, doc);
      const chunkDocId = await ctx.db.insert("chunks", {
        dataSource: "pylon",
        sourceId: ticket.pylonId,
        chunkId: `${ticket.pylonId}-0`,
        text: `ISSUE: ${ticket.title}\nCompany: ${ticket.companyName}\nPriority: ${ticket.priority}\n\n${ticket.conversation}`,
        companyDomain: ticket.companyDomain,
        ingestedAt: new Date(now).toISOString(),
        authors: [ticket.requesterEmail, "Support"],
        needsEmbedding: true,
        competitorMentions: ticket.competitorMentions ?? [],
      });
      const chunkDoc = await ctx.db.get(chunkDocId);
      if (chunkDoc) await chunksAggregate.insertIfDoesNotExist(ctx, chunkDoc);
    }

    await ctx.db.insert("slackChannelCache", { channelId: `${DEMO_PREFIX}customer-voice`, name: "customer-voice", isPrivate: false, memberCount: 42, isJoined: true, refreshedAt: now });
    await ctx.db.insert("slackChannelCache", { channelId: `${DEMO_PREFIX}product-feedback`, name: "product-feedback", isPrivate: false, memberCount: 31, isJoined: true, refreshedAt: now });
    await ctx.db.insert("slackUserCache", { userId: `${DEMO_PREFIX}support-user`, username: "support", realName: "Demo Support", email: "support@example.com", refreshedAt: now });
    for (const [companyIndex, company] of data.companies.entries()) {
      const companyId = companyIds.get(company.domain);
      if (!companyId) continue;
      const recentCall = data.calls.filter((call) => call.companyDomain === company.domain).sort((a, b) => b.started.localeCompare(a.started))[0];
      const recentTicket = data.tickets.filter((ticket) => ticket.companyDomain === company.domain).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const mentionTexts = [
        `${company.name}: ${recentCall?.brief ?? "The account team shared new product feedback."}`,
        `${company.name} support follow-up: ${recentTicket?.title ?? "Review the latest customer request"}.`,
      ];
      for (const [mentionIndex, mentionText] of mentionTexts.entries()) {
        const channelName = mentionIndex === 0 ? "customer-voice" : "product-feedback";
        const messageTs = String(now / 1000 - companyIndex * 100 - mentionIndex);
        await ctx.db.insert("slackCompanyMentions", {
          companyId,
          domain: company.domain,
          channelId: `${DEMO_PREFIX}${channelName}`,
          channelName,
          messageTs,
          threadTs: messageTs,
          text: mentionText,
          matchedTerms: [company.name, company.domain],
          authorName: "Demo Support",
          authorUserId: `${DEMO_PREFIX}support-user`,
          postedAt: new Date(now - (companyIndex + mentionIndex + 1) * 86_400_000).toISOString(),
          createdAt: now - (companyIndex + mentionIndex) * 1_000,
        });
      }
    }

    const competitorRows = buildDemoCompetitorRows({ data });
    for (const range of ["week", "month", "year"]) {
      const existingCache = await ctx.db.query("competitorLeaderboardCache").withIndex("by_range", (q) => q.eq("range", range)).first();
      if (existingCache) continue;
      await ctx.db.insert("competitorLeaderboardCache", {
        range,
        rows: competitorRows,
        computedAt: now,
      });
    }

    return {
      companies: data.companies.length,
      calls: data.calls.length,
      issues: data.tickets.length,
      chunks: data.calls.length + data.tickets.length,
      timelineEvents: data.companies.length * 2,
      slackMentions: data.companies.length * 2,
      competitors: competitorRows.length,
    };
  },
});
