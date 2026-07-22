import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAuthenticated } from "../lib/convex/auth";
import { incrementCompanyLifetimeRevenue, addCompanyRevenueCategory } from "../lib/convex/companies";

// One-off import of per-deal revenue records from a configured sales-wins
// Slack export. Idempotent: skips deals already inserted for a domain
// (matched by date + opportunityName).
export const insertCompanyRevenueDealsInternal = internalMutation({
  args: {
    deals: v.array(v.object({
      domain: v.string(),
      date: v.string(),
      month: v.string(),
      year: v.number(),
      amount: v.number(),
      opportunityName: v.string(),
      opportunityType: v.union(v.literal("Net New"), v.literal("Expansion"), v.literal("Renewal")),
      category: v.union(v.literal("inference"), v.literal("gpu_cluster"), v.literal("credits_other")),
      label: v.string(),
      acrConfidence: v.optional(v.string()),
    })),
  },
  handler: async (ctx, { deals }) => {
    const now = Date.now();
    let inserted = 0;
    let skipped = 0;

    for (const deal of deals) {
      const existing = await ctx.db
        .query("companyRevenueDeals")
        .withIndex("by_domain", (q) => q.eq("domain", deal.domain))
        .filter((q) => q.and(
          q.eq(q.field("date"), deal.date),
          q.eq(q.field("opportunityName"), deal.opportunityName),
        ))
        .first();
      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert("companyRevenueDeals", {
        ...deal,
        source: "slack",
        createdAt: now,
      });
      await incrementCompanyLifetimeRevenue({ ctx, domain: deal.domain, amount: deal.amount, year: deal.year });
      await addCompanyRevenueCategory({ ctx, domain: deal.domain, category: deal.category });
      inserted++;
    }

    return { inserted, skipped };
  },
});

// One-off correction for deals where the recorded "amount" is a multi-year
// total contract value rather than a single year's revenue (e.g. a 5-year
// GPU cluster commitment reported as one lump sum). Splits the matching
// deal into `years` equal yearly records, one year apart starting from the
// original deal date.
export const splitDealAcrossYearsInternal = internalMutation({
  args: {
    domain: v.string(),
    opportunityName: v.string(),
    years: v.number(),
  },
  handler: async (ctx, { domain, opportunityName, years }) => {
    const existing = await ctx.db
      .query("companyRevenueDeals")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .filter((q) => q.eq(q.field("opportunityName"), opportunityName))
      .first();
    if (!existing) throw new Error(`Deal not found: ${domain} / ${opportunityName}`);

    const yearlyAmount = existing.amount / years;
    const acrConfidence = `split_${years}yr_tcv`;
    const baseDate = new Date(existing.date);

    await ctx.db.patch(existing._id, {
      amount: yearlyAmount,
      label: `${existing.label} (1/${years} yr)`,
      acrConfidence,
    });

    for (let i = 1; i < years; i++) {
      const date = new Date(baseDate);
      date.setUTCFullYear(date.getUTCFullYear() + i);
      const isoDate = date.toISOString();

      await ctx.db.insert("companyRevenueDeals", {
        domain: existing.domain,
        date: isoDate,
        month: isoDate.slice(0, 7),
        year: date.getUTCFullYear(),
        amount: yearlyAmount,
        opportunityName: existing.opportunityName,
        opportunityType: existing.opportunityType,
        category: existing.category,
        label: `${existing.label} (${i + 1}/${years} yr)`,
        acrConfidence,
        source: existing.source,
        createdAt: Date.now(),
      });
    }

    return { yearlyAmount, years };
  },
});

// Per-company revenue totals for a given year, derived from
// companyRevenueDeals. Used to filter/annotate the companies list without
// running a query per company.
export const getRevenueByYear = query({
  args: { year: v.number() },
  handler: async (ctx, { year }) => {
    await requireAuthenticated({ ctx });

    const deals = await ctx.db
      .query("companyRevenueDeals")
      .withIndex("by_year", (q) => q.eq("year", year))
      .collect();

    const byDomain = new Map<string, { amount: number; dealCount: number }>();
    for (const deal of deals) {
      const entry = byDomain.get(deal.domain) ?? { amount: 0, dealCount: 0 };
      entry.amount += deal.amount;
      entry.dealCount += 1;
      byDomain.set(deal.domain, entry);
    }

    return [...byDomain.entries()]
      .map(([domain, { amount, dealCount }]) => ({ domain, amount, dealCount }))
      .sort((a, b) => b.amount - a.amount);
  },
});

// All revenue deals across every company. Used by the /revenue page to
// build a frontend-aggregated monthly/yearly stacked bar chart.
export const listRevenueDeals = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticated({ ctx });

    return await ctx.db.query("companyRevenueDeals").collect();
  },
});

// All revenue deals for a company (including domain aliases), newest first.
// Used to render the revenue timeline on the company detail page.
export const getRevenueDealsForCompany = query({
  args: { companyId: v.id("companyProfiles") },
  handler: async (ctx, { companyId }) => {
    await requireAuthenticated({ ctx });

    const company = await ctx.db.get(companyId);
    if (!company) return [];

    const domains = [company.domain, ...(company.domainAliases ?? [])];
    const dealArrays = await Promise.all(
      domains.map((d) =>
        ctx.db
          .query("companyRevenueDeals")
          .withIndex("by_domain", (q) => q.eq("domain", d))
          .collect()
      )
    );

    return dealArrays.flat().sort((a, b) => b.date.localeCompare(a.date));
  },
});
