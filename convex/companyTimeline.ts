import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { buildReflectionPrompt, reflectionOutputSchema } from "../lib/convex/companyTimeline";
import { requireAuthenticated } from "../lib/convex/auth";
import { hasTogetherCredentials } from "../lib/integrations";

const togetherai = createOpenAICompatible({
  name: "togetherai",
  apiKey: process.env.TOGETHER_API_KEY,
  baseURL: "https://api.together.xyz/v1",
  supportsStructuredOutputs: true,
});

const REFLECTION_MODELS = [
  "MiniMaxAI/MiniMax-M3",
  "moonshotai/Kimi-K2.6",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
] as const;


// ── Internal queries ──────────────────────────────────────────────────────────

export const findActiveCompanyDomainsInternal = internalQuery({
  args: { fromDate: v.string() },
  handler: async (ctx, { fromDate }): Promise<string[]> => {
    const [calls, tickets] = await Promise.all([
      ctx.db
        .query("calls")
        .withIndex("by_started", (q) => q.gte("started", fromDate))
        .collect(),
      ctx.db
        .query("pylonIssues")
        .withIndex("by_created", (q) => q.gte("createdAt", fromDate))
        .collect(),
    ]);
    const domains = new Set<string>();
    for (const c of calls) if (c.companyDomain) domains.add(c.companyDomain);
    for (const t of tickets) if (t.companyDomain) domains.add(t.companyDomain);
    return Array.from(domains);
  },
});

export const getCompanyProfileByDomainInternal = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, { domain }): Promise<Doc<"companyProfiles"> | null> => {
    return ctx.db
      .query("companyProfiles")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .first();
  },
});

export const getCompanyCallsForWeekInternal = internalQuery({
  args: { domain: v.string(), fromDate: v.string(), toDate: v.optional(v.string()) },
  handler: async (ctx, { domain, fromDate, toDate }): Promise<Doc<"calls">[]> => {
    const results = await ctx.db
      .query("calls")
      .withIndex("by_company_started", (q) =>
        q.eq("companyDomain", domain).gte("started", fromDate)
      )
      .order("asc")
      .collect();
    return toDate ? results.filter((c) => c.started < toDate) : results.slice(-20);
  },
});

export const getCompanyTicketsForWeekInternal = internalQuery({
  args: { domain: v.string(), fromDate: v.string(), toDate: v.optional(v.string()) },
  handler: async (ctx, { domain, fromDate, toDate }): Promise<Doc<"pylonIssues">[]> => {
    const results = await ctx.db
      .query("pylonIssues")
      .withIndex("by_company_created", (q) =>
        q.eq("companyDomain", domain).gte("createdAt", fromDate)
      )
      .order("asc")
      .collect();
    return toDate ? results.filter((t) => t.createdAt < toDate) : results.slice(-20);
  },
});

export const getCompanySlackMentionsForWeekInternal = internalQuery({
  args: { companyId: v.id("companyProfiles"), fromDate: v.string(), toDate: v.optional(v.string()) },
  handler: async (ctx, { companyId, fromDate, toDate }): Promise<Doc<"slackCompanyMentions">[]> => {
    const results = await ctx.db
      .query("slackCompanyMentions")
      .withIndex("by_company_posted", (q) =>
        q.eq("companyId", companyId).gte("postedAt", fromDate)
      )
      .order("asc")
      .collect();
    return toDate ? results.filter((m) => m.postedAt < toDate) : results.slice(-20);
  },
});

export const getPreviousReflectionInternal = internalQuery({
  args: { companyId: v.id("companyProfiles"), beforeWeekStart: v.string() },
  handler: async (ctx, { companyId, beforeWeekStart }): Promise<{ weekStart: string; riskScore: number; content: string } | null> => {
    const entry = await ctx.db
      .query("companyTimeline")
      .withIndex("by_company_date", (q) => q.eq("companyId", companyId))
      .order("desc")
      .filter((q) =>
        q.and(
          q.eq(q.field("type"), "ai_reflection"),
          q.lt(q.field("weekStart"), beforeWeekStart),
        )
      )
      .first();
    if (!entry || entry.weekStart === undefined) return null;
    return { weekStart: entry.weekStart!, riskScore: entry.riskScore ?? 0, content: entry.content };
  },
});

export const getExistingReflectionInternal = internalQuery({
  args: { companyId: v.id("companyProfiles"), weekStart: v.string() },
  handler: async (ctx, { companyId, weekStart }): Promise<Doc<"companyTimeline"> | null> => {
    // weekStart is stored as ISO string in "YYYY-MM-DD" format; we check for any
    // ai_reflection for this company with a matching weekStart to avoid duplicates.
    const entries = await ctx.db
      .query("companyTimeline")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .filter((q) =>
        q.and(
          q.eq(q.field("type"), "ai_reflection"),
          q.eq(q.field("weekStart"), weekStart)
        )
      )
      .first();
    return entries;
  },
});

export const listAllReflectionsInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"companyTimeline">[]> => {
    return ctx.db
      .query("companyTimeline")
      .withIndex("by_type_date", (q) => q.eq("type", "ai_reflection"))
      .collect();
  },
});

export const getCompanyProfileByIdInternal = internalQuery({
  args: { companyId: v.id("companyProfiles") },
  handler: async (ctx, { companyId }): Promise<Doc<"companyProfiles"> | null> => {
    return ctx.db.get(companyId);
  },
});

// ── Internal mutations ────────────────────────────────────────────────────────

export const insertTimelineEntryInternal = internalMutation({
  args: {
    companyId: v.id("companyProfiles"),
    type: v.union(v.literal("ai_reflection"), v.literal("manual_note")),
    date: v.number(),
    content: v.string(),
    riskScore: v.optional(v.number()),
    riskReason: v.optional(v.string()),
    weekStart: v.optional(v.string()),
    detectedCompetitors: v.optional(v.array(v.string())),
    authorEmail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"companyTimeline">> => {
    return ctx.db.insert("companyTimeline", { ...args, createdAt: Date.now() });
  },
});

export const deleteTimelineEntryInternal = internalMutation({
  args: { id: v.id("companyTimeline") },
  handler: async (ctx, { id }): Promise<void> => {
    await ctx.db.delete(id);
  },
});

export const deleteAllReflectionsForDomainsInternal = internalMutation({
  args: { domains: v.array(v.string()) },
  handler: async (ctx, { domains }): Promise<number> => {
    let deleted = 0;
    for (const domain of domains) {
      const company = await ctx.db.query("companyProfiles").withIndex("by_domain", (q) => q.eq("domain", domain)).first();
      if (!company) continue;
      const entries = await ctx.db.query("companyTimeline").withIndex("by_company", (q) => q.eq("companyId", company._id)).filter((q) => q.eq(q.field("type"), "ai_reflection")).collect();
      for (const e of entries) { await ctx.db.delete(e._id); deleted++; }
    }
    return deleted;
  },
});

// ── Internal action ───────────────────────────────────────────────────────────

async function runReflectionLLM({ prompt }: { prompt: string }) {
  let lastError: Error | null = null;
  for (const model of REFLECTION_MODELS) {
    try {
      const { output } = await generateText({
        model: togetherai(model),
        output: Output.object({ schema: reflectionOutputSchema }),
        prompt,
      });
      return output;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[weekly-reflections] model ${model} failed:`, lastError.message);
    }
  }
  throw lastError ?? new Error("All reflection models failed");
}

export const generateWeeklyReflectionsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (!hasTogetherCredentials()) return;
    const now = new Date();
    // Snap to the most recent Monday so week boundaries align with calendar weeks
    const thisMon = new Date(now);
    const dow = thisMon.getUTCDay();
    thisMon.setUTCDate(thisMon.getUTCDate() - (dow === 0 ? 6 : dow - 1));
    thisMon.setUTCHours(0, 0, 0, 0);
    const weekEnd = thisMon.toISOString().split("T")[0]!;
    const weekStartDate = new Date(thisMon);
    weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 7);
    const weekStart = weekStartDate.toISOString().split("T")[0]!;

    const activeDomains: string[] = await ctx.runQuery(
      internal.companyTimeline.findActiveCompanyDomainsInternal,
      { fromDate: weekStart }
    );

    console.log(
      `[weekly-reflections] ${activeDomains.length} active companies for ${weekStart}–${weekEnd}`
    );

    let generated = 0;
    let skipped = 0;

    for (const domain of activeDomains) {
      const company = await ctx.runQuery(
        internal.companyTimeline.getCompanyProfileByDomainInternal,
        { domain }
      );
      if (!company) { skipped++; continue; }

      const existing = await ctx.runQuery(
        internal.companyTimeline.getExistingReflectionInternal,
        { companyId: company._id, weekStart }
      );
      if (existing) { skipped++; continue; }

      const allDomains = [domain, ...(company.domainAliases ?? [])];

      const [callArrays, ticketArrays, slackMentions] = await Promise.all([
        Promise.all(
          allDomains.map((d) =>
            ctx.runQuery(internal.companyTimeline.getCompanyCallsForWeekInternal, {
              domain: d,
              fromDate: weekStart,
            })
          )
        ),
        Promise.all(
          allDomains.map((d) =>
            ctx.runQuery(internal.companyTimeline.getCompanyTicketsForWeekInternal, {
              domain: d,
              fromDate: weekStart,
            })
          )
        ),
        ctx.runQuery(internal.companyTimeline.getCompanySlackMentionsForWeekInternal, {
          companyId: company._id,
          fromDate: weekStart,
        }),
      ]);

      const calls = callArrays.flat();
      const tickets = ticketArrays.flat();

      if (calls.length === 0 && tickets.length === 0 && slackMentions.length === 0) {
        console.log(`[weekly-reflections] Skip ${domain} ${weekStart} (no activity)`);
        skipped++;
        continue;
      }

      const prevReflection = await ctx.runQuery(
        internal.companyTimeline.getPreviousReflectionInternal,
        { companyId: company._id, beforeWeekStart: weekStart }
      );
      const prompt = buildReflectionPrompt({
        input: {
          companyName: company.name,
          companyDomain: company.domain,
          companyStatus: company.status,
          weekStart,
          weekEnd,
          calls: calls.map((c) => ({
            title: c.title,
            date: c.started.split("T")[0]!,
            durationMin: Math.round(c.duration / 60),
            brief: c.brief,
            keyPoints: c.keyPoints,
          })),
          tickets: tickets.map((t) => ({
            title: t.title,
            date: t.createdAt.split("T")[0]!,
            state: t.state,
            priority: t.priority,
            category: t.issueCategory,
          })),
          slackMentions: slackMentions.map((m) => ({
            channel: m.channelName,
            date: m.postedAt.split("T")[0]!,
            text: m.text,
            author: m.authorName,
          })),
          previousReflection: prevReflection
            ? { weekStart: prevReflection.weekStart, riskScore: prevReflection.riskScore, narrative: prevReflection.content }
            : undefined,
        },
      });

      try {
        const output = await runReflectionLLM({ prompt });
        await ctx.runMutation(internal.companyTimeline.insertTimelineEntryInternal, {
          companyId: company._id,
          type: "ai_reflection",
          date: now.getTime(),
          content: output.narrative,
          riskScore: output.riskScore,
          riskReason: output.riskReason,
          weekStart,
          detectedCompetitors:
            output.detectedCompetitors.length > 0 ? output.detectedCompetitors : undefined,
        });
        generated++;
      } catch (err) {
        console.error(`[weekly-reflections] Failed for ${domain}:`, err);
      }
    }

    console.log(`[weekly-reflections] done: generated=${generated} skipped=${skipped}`);
  },
});

export const forceRegenerateForDomainsInternal = internalAction({
  args: { domains: v.array(v.string()) },
  handler: async (ctx, { domains }): Promise<void> => {
    const now = new Date();
    const weekEnd = now.toISOString().split("T")[0]!;
    const weekStartDate = new Date(now);
    weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 7);
    const weekStart = weekStartDate.toISOString().split("T")[0]!;

    for (const domain of domains) {
      const company = await ctx.runQuery(
        internal.companyTimeline.getCompanyProfileByDomainInternal,
        { domain }
      );
      if (!company) {
        console.warn(`[force-regen] No company profile for ${domain}`);
        continue;
      }

      const existing = await ctx.runQuery(
        internal.companyTimeline.getExistingReflectionInternal,
        { companyId: company._id, weekStart }
      );
      if (existing) {
        await ctx.runMutation(internal.companyTimeline.deleteTimelineEntryInternal, { id: existing._id });
        console.log(`[force-regen] Deleted existing reflection for ${domain} (${weekStart})`);
      }

      // Also delete any reflection with the previous weekStart (2026-06-08) to catch stale ones
      const allDomains = [domain, ...(company.domainAliases ?? [])];

      const [callArrays, ticketArrays, slackMentions] = await Promise.all([
        Promise.all(
          allDomains.map((d) =>
            ctx.runQuery(internal.companyTimeline.getCompanyCallsForWeekInternal, {
              domain: d,
              fromDate: weekStart,
            })
          )
        ),
        Promise.all(
          allDomains.map((d) =>
            ctx.runQuery(internal.companyTimeline.getCompanyTicketsForWeekInternal, {
              domain: d,
              fromDate: weekStart,
            })
          )
        ),
        ctx.runQuery(internal.companyTimeline.getCompanySlackMentionsForWeekInternal, {
          companyId: company._id,
          fromDate: weekStart,
        }),
      ]);

      const calls = callArrays.flat();
      const tickets = ticketArrays.flat();

      const prevReflection = await ctx.runQuery(
        internal.companyTimeline.getPreviousReflectionInternal,
        { companyId: company._id, beforeWeekStart: weekStart }
      );
      const prompt = buildReflectionPrompt({
        input: {
          companyName: company.name,
          companyDomain: company.domain,
          companyStatus: company.status,
          weekStart,
          weekEnd,
          calls: calls.map((c) => ({
            title: c.title,
            date: c.started.split("T")[0]!,
            durationMin: Math.round(c.duration / 60),
            brief: c.brief,
            keyPoints: c.keyPoints,
          })),
          tickets: tickets.map((t) => ({
            title: t.title,
            date: t.createdAt.split("T")[0]!,
            state: t.state,
            priority: t.priority,
            category: t.issueCategory,
          })),
          slackMentions: slackMentions.map((m) => ({
            channel: m.channelName,
            date: m.postedAt.split("T")[0]!,
            text: m.text,
            author: m.authorName,
          })),
          previousReflection: prevReflection
            ? { weekStart: prevReflection.weekStart, riskScore: prevReflection.riskScore, narrative: prevReflection.content }
            : undefined,
        },
      });

      try {
        const output = await runReflectionLLM({ prompt });
        await ctx.runMutation(internal.companyTimeline.insertTimelineEntryInternal, {
          companyId: company._id,
          type: "ai_reflection",
          date: now.getTime(),
          content: output.narrative,
          riskScore: output.riskScore,
          riskReason: output.riskReason,
          weekStart,
          detectedCompetitors: output.detectedCompetitors,
        });
        console.log(`[force-regen] Done ${domain}: score=${output.riskScore}`);
      } catch (err) {
        console.error(`[force-regen] Failed for ${domain}:`, err);
      }
    }
  },
});

export const generateHistoricalReflectionsInternal = internalAction({
  args: {
    domains: v.array(v.string()),
    fromDate: v.string(), // "YYYY-MM-DD" — first week start
  },
  handler: async (ctx, { domains, fromDate }): Promise<void> => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Build list of week start dates (Mondays) from fromDate up to last full week.
    // Snap fromDate back to the nearest Monday so windows align with calendar weeks.
    const weekStarts: string[] = [];
    const cursor = new Date(fromDate + "T00:00:00Z");
    const dow = cursor.getUTCDay(); // 0=Sun,1=Mon,...
    const daysToMonday = dow === 0 ? 6 : dow - 1;
    cursor.setUTCDate(cursor.getUTCDate() - daysToMonday);
    while (cursor < today) {
      weekStarts.push(cursor.toISOString().split("T")[0]!);
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }

    console.log(`[hist-reflect] ${domains.length} domains × ${weekStarts.length} weeks = ${domains.length * weekStarts.length} total`);

    for (const domain of domains) {
      const company = await ctx.runQuery(
        internal.companyTimeline.getCompanyProfileByDomainInternal,
        { domain }
      );
      if (!company) { console.warn(`[hist-reflect] No profile for ${domain}`); continue; }

      const allDomains = [domain, ...(company.domainAliases ?? [])];

      for (const weekStart of weekStarts) {
        const weekEndDate = new Date(weekStart + "T00:00:00Z");
        weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
        const weekEnd = weekEndDate.toISOString().split("T")[0]!;

        const existing = await ctx.runQuery(
          internal.companyTimeline.getExistingReflectionInternal,
          { companyId: company._id, weekStart }
        );
        if (existing) {
          console.log(`[hist-reflect] Skip ${domain} ${weekStart} (exists)`);
          continue;
        }

        const [callArrays, ticketArrays, slackMentions] = await Promise.all([
          Promise.all(allDomains.map((d) => ctx.runQuery(internal.companyTimeline.getCompanyCallsForWeekInternal, { domain: d, fromDate: weekStart, toDate: weekEnd }))),
          Promise.all(allDomains.map((d) => ctx.runQuery(internal.companyTimeline.getCompanyTicketsForWeekInternal, { domain: d, fromDate: weekStart, toDate: weekEnd }))),
          ctx.runQuery(internal.companyTimeline.getCompanySlackMentionsForWeekInternal, { companyId: company._id, fromDate: weekStart, toDate: weekEnd }),
        ]);

        const calls = callArrays.flat();
        const tickets = ticketArrays.flat();

        if (calls.length === 0 && tickets.length === 0 && slackMentions.length === 0) {
          console.log(`[hist-reflect] Skip ${domain} ${weekStart} (no activity)`);
          continue;
        }

        const prevReflection = await ctx.runQuery(
          internal.companyTimeline.getPreviousReflectionInternal,
          { companyId: company._id, beforeWeekStart: weekStart }
        );
        const prompt = buildReflectionPrompt({
          input: {
            companyName: company.name,
            companyDomain: company.domain,
            companyStatus: company.status,
            weekStart,
            weekEnd,
            calls: calls.map((c) => ({
              title: c.title,
              date: c.started.split("T")[0]!,
              durationMin: Math.round(c.duration / 60),
              brief: c.brief,
              keyPoints: c.keyPoints,
            })),
            tickets: tickets.map((t) => ({
              title: t.title,
              date: t.createdAt.split("T")[0]!,
              state: t.state,
              priority: t.priority,
              category: t.issueCategory,
            })),
            slackMentions: slackMentions.map((m) => ({
              channel: m.channelName,
              date: m.postedAt.split("T")[0]!,
              text: m.text,
              author: m.authorName,
            })),
            previousReflection: prevReflection
              ? { weekStart: prevReflection.weekStart, riskScore: prevReflection.riskScore, narrative: prevReflection.content }
              : undefined,
          },
        });

        try {
          const output = await runReflectionLLM({ prompt });
          const weekMidpoint = new Date(weekStart + "T00:00:00Z");
          weekMidpoint.setUTCDate(weekMidpoint.getUTCDate() + 3);
          await ctx.runMutation(internal.companyTimeline.insertTimelineEntryInternal, {
            companyId: company._id,
            type: "ai_reflection",
            date: weekMidpoint.getTime(),
            content: output.narrative,
            riskScore: output.riskScore,
            riskReason: output.riskReason,
            weekStart,
            detectedCompetitors: output.detectedCompetitors,
          });
          console.log(`[hist-reflect] ${domain} ${weekStart}: score=${output.riskScore} calls=${calls.length} tickets=${tickets.length}`);
        } catch (err) {
          console.error(`[hist-reflect] Failed ${domain} ${weekStart}:`, err);
        }
      }
    }
  },
});

export const forceRegenerateWeekInternal = internalAction({
  args: { domains: v.array(v.string()), weekStart: v.string() },
  handler: async (ctx, { domains, weekStart }): Promise<void> => {
    const weekEndDate = new Date(weekStart + "T00:00:00Z");
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
    const weekEnd = weekEndDate.toISOString().split("T")[0]!;

    for (const domain of domains) {
      const company = await ctx.runQuery(internal.companyTimeline.getCompanyProfileByDomainInternal, { domain });
      if (!company) { console.warn(`[regen-week] No profile for ${domain}`); continue; }

      const existing = await ctx.runQuery(internal.companyTimeline.getExistingReflectionInternal, { companyId: company._id, weekStart });
      if (existing) {
        await ctx.runMutation(internal.companyTimeline.deleteTimelineEntryInternal, { id: existing._id });
      }

      const allDomains = [domain, ...(company.domainAliases ?? [])];
      const [callArrays, ticketArrays, slackMentions] = await Promise.all([
        Promise.all(allDomains.map((d) => ctx.runQuery(internal.companyTimeline.getCompanyCallsForWeekInternal, { domain: d, fromDate: weekStart, toDate: weekEnd }))),
        Promise.all(allDomains.map((d) => ctx.runQuery(internal.companyTimeline.getCompanyTicketsForWeekInternal, { domain: d, fromDate: weekStart, toDate: weekEnd }))),
        ctx.runQuery(internal.companyTimeline.getCompanySlackMentionsForWeekInternal, { companyId: company._id, fromDate: weekStart, toDate: weekEnd }),
      ]);

      const calls = callArrays.flat();
      const tickets = ticketArrays.flat();

      if (calls.length === 0 && tickets.length === 0 && slackMentions.length === 0) {
        console.log(`[regen-week] Skip ${domain} ${weekStart} (no activity)`);
        continue;
      }

      const prevReflection = await ctx.runQuery(
        internal.companyTimeline.getPreviousReflectionInternal,
        { companyId: company._id, beforeWeekStart: weekStart }
      );
      const prompt = buildReflectionPrompt({
        input: {
          companyName: company.name,
          companyDomain: company.domain,
          companyStatus: company.status,
          weekStart,
          weekEnd,
          calls: calls.map((c) => ({ title: c.title, date: c.started.split("T")[0]!, durationMin: Math.round(c.duration / 60), brief: c.brief, keyPoints: c.keyPoints })),
          tickets: tickets.map((t) => ({ title: t.title, date: t.createdAt.split("T")[0]!, state: t.state, priority: t.priority, category: t.issueCategory })),
          slackMentions: slackMentions.map((m) => ({ channel: m.channelName, date: m.postedAt.split("T")[0]!, text: m.text, author: m.authorName })),
          previousReflection: prevReflection
            ? { weekStart: prevReflection.weekStart, riskScore: prevReflection.riskScore, narrative: prevReflection.content }
            : undefined,
        },
      });

      try {
        const output = await runReflectionLLM({ prompt });
        const weekMidpoint = new Date(weekStart + "T00:00:00Z");
        weekMidpoint.setUTCDate(weekMidpoint.getUTCDate() + 3);
        await ctx.runMutation(internal.companyTimeline.insertTimelineEntryInternal, {
          companyId: company._id,
          type: "ai_reflection",
          date: weekMidpoint.getTime(),
          content: output.narrative,
          riskScore: output.riskScore,
          riskReason: output.riskReason,
          weekStart,
          detectedCompetitors: output.detectedCompetitors,
        });
        console.log(`[regen-week] ${domain} ${weekStart}: score=${output.riskScore} competitors=${JSON.stringify(output.detectedCompetitors)}`);
      } catch (err) {
        console.error(`[regen-week] Failed ${domain} ${weekStart}:`, err);
      }
    }
  },
});

// ── Public queries ────────────────────────────────────────────────────────────

export const getLatestRiskScores = query({
  args: { companyIds: v.array(v.id("companyProfiles")) },
  handler: async (ctx, { companyIds }): Promise<Record<string, number | null>> => {
    await requireAuthenticated({ ctx });
    const entries = await Promise.all(
      companyIds.map((companyId) =>
        ctx.db
          .query("companyTimeline")
          .withIndex("by_company_date", (q) => q.eq("companyId", companyId))
          .order("desc")
          .filter((q) => q.eq(q.field("type"), "ai_reflection"))
          .first()
      )
    );
    return Object.fromEntries(
      companyIds.map((id, i) => [id, entries[i]?.riskScore ?? null])
    );
  },
});

export const getLatestReflection = query({
  args: { companyId: v.id("companyProfiles") },
  handler: async (ctx, { companyId }): Promise<Doc<"companyTimeline"> | null> => {
    await requireAuthenticated({ ctx });
    return ctx.db
      .query("companyTimeline")
      .withIndex("by_company_date", (q) => q.eq("companyId", companyId))
      .order("desc")
      .filter((q) => q.eq(q.field("type"), "ai_reflection"))
      .first();
  },
});

export const getCompanyTimeline = query({
  args: {
    companyId: v.id("companyProfiles"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { companyId, limit = 20 }): Promise<Doc<"companyTimeline">[]> => {
    await requireAuthenticated({ ctx });
    return ctx.db
      .query("companyTimeline")
      .withIndex("by_company_date", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(limit);
  },
});

// ── Public mutations ──────────────────────────────────────────────────────────

export const addManualNote = mutation({
  args: {
    companyId: v.id("companyProfiles"),
    content: v.string(),
    date: v.optional(v.number()), // backdatable; defaults to now
  },
  handler: async (ctx, { companyId, content, date }): Promise<Id<"companyTimeline">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    return ctx.db.insert("companyTimeline", {
      companyId,
      type: "manual_note",
      date: date ?? Date.now(),
      content,
      authorEmail: identity.email ?? undefined,
      createdAt: Date.now(),
    });
  },
});

// ── Cleanup ───────────────────────────────────────────────────────────────────

// Scans every ai_reflection in the DB and deletes ones whose week had zero
// calls, tickets, and Slack mentions — these are phantom reflections generated
// before the empty-week guard was in place.
export const deleteEmptyWeekReflectionsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ deleted: number; kept: number }> => {
    const allReflections = await ctx.runQuery(
      internal.companyTimeline.listAllReflectionsInternal,
      {}
    );

    let deleted = 0;
    let kept = 0;

    for (const entry of allReflections) {
      if (!entry.weekStart) { kept++; continue; }

      const weekEndDate = new Date(entry.weekStart + "T00:00:00Z");
      weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 7);
      const weekEnd = weekEndDate.toISOString().split("T")[0]!;

      const company = await ctx.runQuery(
        internal.companyTimeline.getCompanyProfileByIdInternal,
        { companyId: entry.companyId }
      );
      if (!company) {
        // orphaned reflection — delete it
        await ctx.runMutation(internal.companyTimeline.deleteTimelineEntryInternal, { id: entry._id });
        deleted++;
        continue;
      }

      const allDomains = [company.domain, ...(company.domainAliases ?? [])];

      const [callArrays, ticketArrays, slackMentions] = await Promise.all([
        Promise.all(allDomains.map((d) =>
          ctx.runQuery(internal.companyTimeline.getCompanyCallsForWeekInternal, {
            domain: d,
            fromDate: entry.weekStart!,
            toDate: weekEnd,
          })
        )),
        Promise.all(allDomains.map((d) =>
          ctx.runQuery(internal.companyTimeline.getCompanyTicketsForWeekInternal, {
            domain: d,
            fromDate: entry.weekStart!,
            toDate: weekEnd,
          })
        )),
        ctx.runQuery(internal.companyTimeline.getCompanySlackMentionsForWeekInternal, {
          companyId: entry.companyId,
          fromDate: entry.weekStart!,
          toDate: weekEnd,
        }),
      ]);

      const hasActivity =
        callArrays.flat().length > 0 ||
        ticketArrays.flat().length > 0 ||
        slackMentions.length > 0;

      if (!hasActivity) {
        await ctx.runMutation(internal.companyTimeline.deleteTimelineEntryInternal, { id: entry._id });
        console.log(`[cleanup] Deleted empty-week reflection: ${company.domain} ${entry.weekStart}`);
        deleted++;
      } else {
        kept++;
      }
    }

    console.log(`[cleanup] done: deleted=${deleted} kept=${kept}`);
    return { deleted, kept };
  },
});
