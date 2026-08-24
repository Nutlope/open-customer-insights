import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { getSlackToken, requireSlackToken, slackFetch, slackTsToIso, type SlackHistoryMessage } from "../lib/convex/slack";
import { ensureCompanyProfileForActivity, incrementCompanyLifetimeRevenue, addCompanyRevenueCategory, normalizeCompanyDomain } from "../lib/convex/companies";
import { parseClosedWonMessage, type SalesWinDeal } from "../lib/sales-wins/parse";
import { categorizeDeals, type DealForCategorization } from "../lib/sales-wins/categorizeDeals";
import { buildCompanyProfileIndex, normalizeName, domainRoot, normalizeDomain, looksLikeValidDomain, type CompanyProfile } from "../lib/sales-wins/companyMatch";
import { guessCompanyDomain } from "../lib/sales-wins/guessDomain";
import { hasTogetherCredentials, salesWinsConfig } from "../lib/integrations";

function requireSalesWinsConfig(): { channelId: string; initialTimestamp: string } {
  const config = salesWinsConfig();
  if (!config) {
    throw new Error("SALES_WINS_SLACK_CHANNEL_ID and SALES_WINS_INITIAL_TIMESTAMP are required.");
  }
  return config;
}

const HISTORY_PAGE_LIMIT = 200;
// Closed-won notifications never link to Salesforce's own host as the
// "Company" field — that only happens when Slack auto-unfurls the
// opportunity link itself. Treat it as "no real domain" rather than a deal.
const SALESFORCE_HOST_RE = /\.(force|salesforce)\.com$/i;

type SlackConversationsHistory = {
  messages?: SlackHistoryMessage[];
};

// A deal's "Company" field is sometimes a direct link to the company's own
// website (e.g. `<https://krea.ai|Krea.ai>`) rather than a Salesforce
// record — in that case we can resolve the domain straight from the
// message with no matching/guessing needed.
function extractDirectDomain({ deal }: { deal: SalesWinDeal }): string | null {
  const normalized = normalizeDomain({ value: deal.companyUrl });
  if (!normalized || !looksLikeValidDomain({ value: normalized })) return null;
  if (SALESFORCE_HOST_RE.test(normalized)) return null;
  return normalized;
}

function resolveDomainFromProfiles({
  deal,
  profileIndex,
}: {
  deal: SalesWinDeal;
  profileIndex: ReturnType<typeof buildCompanyProfileIndex>;
}): string | null {
  const normalized = normalizeName({ value: deal.company });
  const root = domainRoot({ domain: deal.companyKey });
  const match =
    profileIndex.byNormalizedName.get(normalized) ??
    profileIndex.byDomainRoot.get(root) ??
    profileIndex.byDomainRoot.get(normalized.replace(/\s+/g, ""));
  return match?.domain ?? null;
}

export const getScanStateInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { channelId } = requireSalesWinsConfig();
    return await ctx.db
      .query("salesWinsScanState")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .unique();
  },
});

export const upsertScanStateInternal = internalMutation({
  args: { lastScannedTs: v.string() },
  handler: async (ctx, { lastScannedTs }) => {
    const { channelId } = requireSalesWinsConfig();
    const existing = await ctx.db
      .query("salesWinsScanState")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { lastScannedTs, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("salesWinsScanState", { channelId, lastScannedTs, updatedAt: Date.now() });
    }
  },
});

export const listCompanyProfilesForMatchInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<CompanyProfile[]> => {
    const profiles = await ctx.db.query("companyProfiles").collect();
    return profiles.map((p) => ({ name: p.name, domain: p.domain, status: p.status, domainAliases: p.domainAliases }));
  },
});

const dealFieldsValidator = {
  date: v.string(),
  month: v.string(),
  year: v.number(),
  amount: v.number(),
  opportunityName: v.string(),
  opportunityType: v.union(v.literal("Net New"), v.literal("Expansion"), v.literal("Renewal")),
  category: v.union(v.literal("inference"), v.literal("gpu_cluster"), v.literal("credits_other")),
  label: v.string(),
  acrConfidence: v.optional(v.string()),
};

// Inserts a deal whose domain was resolved with high confidence (direct
// link in the Slack message, or a name/domain match against an existing
// companyProfiles record). Idempotent on domain + date + opportunityName,
// same as the one-time import (revenue.ts insertCompanyRevenueDealsInternal).
export const insertResolvedRevenueDealInternal = internalMutation({
  args: { domain: v.string(), companyName: v.string(), ...dealFieldsValidator },
  handler: async (ctx, { domain, companyName, ...deal }) => {
    await ensureCompanyProfileForActivity({ ctx, domain, name: companyName, source: "slack", timestamp: Date.parse(deal.date) });

    const existing = await ctx.db
      .query("companyRevenueDeals")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .filter((q) => q.and(q.eq(q.field("date"), deal.date), q.eq(q.field("opportunityName"), deal.opportunityName)))
      .first();
    if (existing) return { inserted: false };

    await ctx.db.insert("companyRevenueDeals", { domain, ...deal, source: "slack", createdAt: Date.now() });
    await incrementCompanyLifetimeRevenue({ ctx, domain, amount: deal.amount, year: deal.year });
    await addCompanyRevenueCategory({ ctx, domain, category: deal.category });
    return { inserted: true };
  },
});

// Queues a deal for manual domain review through internal maintenance functions.
// Idempotent on the source Slack message so re-scanning never duplicates it.
export const insertPendingRevenueDealInternal = internalMutation({
  args: {
    messageTs: v.string(),
    companyName: v.string(),
    companyKey: v.string(),
    suggestedDomain: v.optional(v.string()),
    ...dealFieldsValidator,
  },
  handler: async (ctx, { messageTs, companyName, companyKey, suggestedDomain, ...deal }) => {
    const { channelId } = requireSalesWinsConfig();
    const existing = await ctx.db
      .query("pendingRevenueDeals")
      .withIndex("by_message", (q) => q.eq("channelId", channelId).eq("messageTs", messageTs))
      .first();
    if (existing) return;

    await ctx.db.insert("pendingRevenueDeals", {
      channelId,
      messageTs,
      companyName,
      companyKey,
      suggestedDomain,
      ...deal,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

// Daily cron (see convex/crons.ts): scans the configured sales-wins
// channel for closed-won messages since the last run (seeded from the last
// deal covered by the one-time historical import on first run), resolves
// each deal's company domain, and either imports it directly or queues it
// for manual review.
export const scanSalesWinsInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ messagesScanned: number; dealsImported: number; dealsQueuedForReview: number }> => {
    const config = salesWinsConfig();
    if (!config || !getSlackToken() || !hasTogetherCredentials()) {
      return { messagesScanned: 0, dealsImported: 0, dealsQueuedForReview: 0 };
    }
    const { channelId, initialTimestamp } = config;
    const token = requireSlackToken();
    const state = await ctx.runQuery(internal.salesWins.getScanStateInternal, {});
    const oldest = state?.lastScannedTs ?? initialTimestamp;

    const rawMessages: SlackHistoryMessage[] = [];
    let cursor: string | undefined;
    do {
      const result = await slackFetch<SlackConversationsHistory>({
        token,
        method: "conversations.history",
        params: { channel: channelId, oldest, limit: HISTORY_PAGE_LIMIT, cursor },
      });
      if (!result.ok) throw new Error(result.error ?? "Could not fetch sales-wins channel history.");
      rawMessages.push(...(result.messages ?? []));
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    const newMessages = rawMessages
      .filter((m): m is SlackHistoryMessage & { ts: string } => Boolean(m.ts) && m.ts !== oldest)
      .sort((a, b) => Number(a.ts) - Number(b.ts));

    let latestTs = oldest;
    for (const message of newMessages) {
      if (message.ts > latestTs) latestTs = message.ts;
    }
    if (latestTs !== oldest) {
      await ctx.runMutation(internal.salesWins.upsertScanStateInternal, { lastScannedTs: latestTs });
    }

    const deals: SalesWinDeal[] = [];
    for (const message of newMessages) {
      const deal = parseClosedWonMessage({
        message: {
          ts: message.ts,
          timestamp: slackTsToIso({ ts: message.ts }),
          text: message.text,
          rawText: message.text,
          botId: message.bot_id,
        },
      });
      if (deal) deals.push(deal);
    }

    if (deals.length === 0) return { messagesScanned: newMessages.length, dealsImported: 0, dealsQueuedForReview: 0 };

    const profiles = await ctx.runQuery(internal.salesWins.listCompanyProfilesForMatchInternal, {});
    const profileIndex = buildCompanyProfileIndex({ profiles });

    const categorizationInputs: DealForCategorization[] = deals.map((d) => ({
      opportunityName: d.opportunityName ?? "(untitled)",
      opportunityType: (d.opportunityType ?? "Net New") as DealForCategorization["opportunityType"],
      amount: d.amount,
      businessUseCase: d.businessUseCase,
    }));
    const categorizations = await categorizeDeals({ deals: categorizationInputs });

    let dealsImported = 0;
    let dealsQueuedForReview = 0;

    for (let i = 0; i < deals.length; i++) {
      const deal = deals[i]!;
      const categorization = categorizations[i]!;
      const dealFields = {
        date: deal.date,
        month: deal.date.slice(0, 7),
        year: deal.year,
        amount: deal.amount ?? 0,
        opportunityName: deal.opportunityName ?? "(untitled)",
        opportunityType: (deal.opportunityType ?? "Net New") as "Net New" | "Expansion" | "Renewal",
        category: categorization.category,
        label: categorization.label,
        acrConfidence: deal.acrConfidence ?? undefined,
      };

      const domain = extractDirectDomain({ deal }) ?? resolveDomainFromProfiles({ deal, profileIndex });

      if (domain) {
        const result: { inserted: boolean } = await ctx.runMutation(internal.salesWins.insertResolvedRevenueDealInternal, {
          domain,
          companyName: deal.company,
          ...dealFields,
        });
        if (result.inserted) dealsImported++;
        continue;
      }

      const guess = await guessCompanyDomain({ companyName: deal.company, businessUseCase: deal.businessUseCase }).catch(() => null);
      await ctx.runMutation(internal.salesWins.insertPendingRevenueDealInternal, {
        messageTs: deal.ts,
        companyName: deal.company,
        companyKey: deal.companyKey,
        suggestedDomain: guess?.domain ?? undefined,
        ...dealFields,
      });
      dealsQueuedForReview++;
    }

    return { messagesScanned: newMessages.length, dealsImported, dealsQueuedForReview };
  },
});

export const listPendingRevenueDealsInternal = internalQuery({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))) },
  handler: async (ctx, { status }) => {
    const deals = status
      ? await ctx.db.query("pendingRevenueDeals").withIndex("by_status", (q) => q.eq("status", status)).collect()
      : await ctx.db.query("pendingRevenueDeals").collect();
    return deals.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const approvePendingRevenueDealInternal = internalMutation({
  args: { dealId: v.id("pendingRevenueDeals"), domain: v.string() },
  handler: async (ctx, { dealId, domain }) => {
    const deal = await ctx.db.get(dealId);
    if (!deal || deal.status !== "pending") throw new Error("Deal not found or already resolved");

    const normalizedDomain = normalizeCompanyDomain({ value: domain });
    if (!normalizedDomain) throw new Error("Invalid domain");

    await ensureCompanyProfileForActivity({ ctx, domain: normalizedDomain, name: deal.companyName, source: "slack", timestamp: Date.parse(deal.date) });
    await ctx.db.insert("companyRevenueDeals", {
      domain: normalizedDomain,
      date: deal.date,
      month: deal.month,
      year: deal.year,
      amount: deal.amount,
      opportunityName: deal.opportunityName,
      opportunityType: deal.opportunityType,
      category: deal.category,
      label: deal.label,
      acrConfidence: deal.acrConfidence,
      source: "slack",
      createdAt: Date.now(),
    });
    await incrementCompanyLifetimeRevenue({ ctx, domain: normalizedDomain, amount: deal.amount, year: deal.year });
    await addCompanyRevenueCategory({ ctx, domain: normalizedDomain, category: deal.category });

    await ctx.db.patch(dealId, { status: "approved", resolvedAt: Date.now(), resolvedByEmail: "system", resolvedDomain: normalizedDomain });
  },
});

export const rejectPendingRevenueDealInternal = internalMutation({
  args: { dealId: v.id("pendingRevenueDeals") },
  handler: async (ctx, { dealId }) => {
    const deal = await ctx.db.get(dealId);
    if (!deal || deal.status !== "pending") throw new Error("Deal not found or already resolved");
    await ctx.db.patch(dealId, { status: "rejected", resolvedAt: Date.now(), resolvedByEmail: "system" });
  },
});
