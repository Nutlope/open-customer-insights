import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAuthenticated, requireAdmin } from "../lib/convex/auth";
import { sortCompanyProfiles, incrementCompanyLifetimeRevenue, addCompanyRevenueCategory, LIFETIME_REVENUE_CUTOFF_YEAR, ensureCompanyProfileForActivity, classifyUnknownCompany, isPersonalEmailDomain, selectTopCompaniesByActivityAndRevenue } from "../lib/convex/companies";
import { isPlaceholderDomain } from "../lib/domain/placeholderDomain";

const statusPriority: Record<string, number> = {
  customer: 3,
  former_customer: 2,
  prospect: 1,
  unknown: 0,
};

function mergeStatus(
  a: "customer" | "prospect" | "former_customer" | "unknown",
  b: "customer" | "prospect" | "former_customer" | "unknown",
): "customer" | "prospect" | "former_customer" | "unknown" {
  return (statusPriority[b] ?? 0) > (statusPriority[a] ?? 0) ? b : a;
}

// Resolves a domain (or alias) to its canonical companyProfile.
export async function resolveProfile(db: DatabaseReader, domain: string) {
  const aliasEntry = await db
    .query("domainAliasIndex")
    .withIndex("by_alias", (q) => q.eq("alias", domain))
    .unique();
  const canonical = aliasEntry?.primaryDomain ?? domain;
  return db
    .query("companyProfiles")
    .withIndex("by_domain", (q) => q.eq("domain", canonical))
    .unique();
}

// All domains this company is responsible for (primary + aliases).
function allDomains(profile: { domain: string; domainAliases?: string[] }): string[] {
  return [profile.domain, ...(profile.domainAliases ?? [])];
}

// Merges alias domain companyProfiles into the canonical profile for
// suggestedPrimary, reassigning segment memberships/dismissals and deleting
// the alias rows so they no longer show up as separate companies.
async function mergeDomainsIntoCanonical(
  ctx: MutationCtx,
  { suggestedPrimary, aliasDomains }: { suggestedPrimary: string; aliasDomains: string[] },
): Promise<{ primary: string; aliases: string[] }> {
  const now = Date.now();

  let canonical = await ctx.db
    .query("companyProfiles")
    .withIndex("by_domain", (q) => q.eq("domain", suggestedPrimary))
    .unique();

  if (!canonical) {
    const id = await ctx.db.insert("companyProfiles", {
      domain: suggestedPrimary,
      name: suggestedPrimary,
      status: "unknown",
      sources: [],
      createdAt: now,
      updatedAt: now,
    });
    canonical = await ctx.db.get(id);
  }

  if (!canonical) throw new Error("Failed to find/create canonical profile");

  const domainAliases = new Set(canonical.domainAliases ?? []);
  let status = canonical.status;
  let acr = canonical.acr;
  let salesforceId = canonical.salesforceId;
  let isPotentialCustomer = canonical.isPotentialCustomer;
  let website = canonical.website;
  let description = canonical.description;
  let sources = canonical.sources;
  let lastActivityAt = canonical.lastActivityAt;

  const mergedAliases: string[] = [];

  for (const aliasDomain of aliasDomains) {
    if (aliasDomain === canonical.domain) continue;
    domainAliases.add(aliasDomain);
    mergedAliases.push(aliasDomain);

    const aliasProfile = await ctx.db
      .query("companyProfiles")
      .withIndex("by_domain", (q) => q.eq("domain", aliasDomain))
      .unique();
    if (!aliasProfile) continue;

    status = mergeStatus(status, aliasProfile.status);
    if ((aliasProfile.acr ?? 0) > (acr ?? 0)) acr = aliasProfile.acr;
    if ((aliasProfile.lastActivityAt ?? 0) > (lastActivityAt ?? 0)) lastActivityAt = aliasProfile.lastActivityAt;
    salesforceId = salesforceId ?? aliasProfile.salesforceId;
    isPotentialCustomer = isPotentialCustomer ?? aliasProfile.isPotentialCustomer;
    website = website ?? aliasProfile.website;
    description = description ?? aliasProfile.description;
    for (const source of aliasProfile.sources) {
      if (!sources.includes(source)) sources = [...sources, source];
    }
    for (const a of aliasProfile.domainAliases ?? []) domainAliases.add(a);

    const memberships = await ctx.db
      .query("companySegmentMemberships")
      .withIndex("by_company", (q) => q.eq("companyId", aliasProfile._id))
      .collect();
    for (const membership of memberships) {
      const dupe = await ctx.db
        .query("companySegmentMemberships")
        .withIndex("by_segment_company", (q) => q.eq("segmentId", membership.segmentId).eq("companyId", canonical!._id))
        .unique();
      if (dupe) {
        await ctx.db.delete(membership._id);
      } else {
        await ctx.db.patch(membership._id, { companyId: canonical._id });
      }
    }

    const dismissed = await ctx.db.query("dismissedCompanySegments").collect();
    for (const dismissal of dismissed) {
      if (dismissal.companyId !== aliasProfile._id) continue;
      const dupe = await ctx.db
        .query("dismissedCompanySegments")
        .withIndex("by_segment_company", (q) => q.eq("segmentId", dismissal.segmentId).eq("companyId", canonical!._id))
        .unique();
      if (dupe) {
        await ctx.db.delete(dismissal._id);
      } else {
        await ctx.db.patch(dismissal._id, { companyId: canonical._id, domain: canonical.domain });
      }
    }

    await ctx.db.delete(aliasProfile._id);
  }

  await ctx.db.patch(canonical._id, {
    domainAliases: [...domainAliases],
    status,
    acr,
    salesforceId,
    isPotentialCustomer,
    website,
    description,
    sources,
    lastActivityAt,
    updatedAt: now,
  });

  for (const alias of mergedAliases) {
    const existing = await ctx.db
      .query("domainAliasIndex")
      .withIndex("by_alias", (q) => q.eq("alias", alias))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { primaryDomain: suggestedPrimary });
    } else {
      await ctx.db.insert("domainAliasIndex", { alias, primaryDomain: suggestedPrimary });
    }
  }

  return { primary: suggestedPrimary, aliases: mergedAliases };
}

// ─── upsert (import) ────────────────────────────────────────────────────────

const clayCompanyValidator = v.object({
  domain: v.string(),
  name: v.string(),
  status: v.union(
    v.literal("customer"),
    v.literal("prospect"),
    v.literal("former_customer"),
    v.literal("unknown"),
  ),
  website: v.optional(v.string()),
  salesforceId: v.optional(v.string()),
  acr: v.optional(v.number()),
  isPotentialCustomer: v.optional(v.boolean()),
});

export const upsertCompanies = internalMutation({
  args: { companies: v.array(clayCompanyValidator) },
  handler: async (ctx, { companies }) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const company of companies) {
      if (isPersonalEmailDomain({ domain: company.domain })) continue;

      const existing = await ctx.db
        .query("companyProfiles")
        .withIndex("by_domain", (q) => q.eq("domain", company.domain))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          name: company.name,
          status: mergeStatus(existing.status, company.status),
          website: company.website ?? existing.website,
          salesforceId: company.salesforceId ?? existing.salesforceId,
          acr: company.acr ?? existing.acr,
          isPotentialCustomer: company.isPotentialCustomer ?? existing.isPotentialCustomer,
          sources: existing.sources.includes("clay")
            ? existing.sources
            : ([...existing.sources, "clay"] as typeof existing.sources),
          updatedAt: now,
        });
        updated++;
      } else {
        await ctx.db.insert("companyProfiles", {
          domain: company.domain,
          name: company.name,
          status: company.status,
          sources: ["clay"],
          website: company.website,
          salesforceId: company.salesforceId,
          acr: company.acr,
          isPotentialCustomer: company.isPotentialCustomer,
          createdAt: now,
          updatedAt: now,
        });
        inserted++;
      }
    }

    return { inserted, updated };
  },
});

// ─── internal list (for scripts) ─────────────────────────────────────────────

export const listAllCompaniesInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 3000 }) => {
    return ctx.db.query("companyProfiles").take(limit);
  },
});

// Companies worth watching for Slack mentions in the daily scan (see
// convex/slackMentions.ts): every "prospect", plus the top 20 companies by
// recent activity and top 20 by lifetime revenue (status != "unknown"),
// deduped. Reuses the same "top N" selection as enrichment prioritization
// (see listEnrichmentCandidatesInternal in convex/enrichment.ts) since both
// want to focus on the companies most likely to matter.
export const listSlackWatchlistCompaniesInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("companyProfiles").collect();
    const prospects = all.filter((company) => company.status === "prospect");
    const topByActivityAndRevenue = selectTopCompaniesByActivityAndRevenue({
      companies: all.filter((company) => company.status !== "unknown"),
      limitEach: 20,
    });

    const seen = new Set<Id<"companyProfiles">>();
    const combined: Array<{ _id: Id<"companyProfiles">; name: string; domain: string }> = [];
    for (const company of [...prospects, ...topByActivityAndRevenue]) {
      if (seen.has(company._id)) continue;
      seen.add(company._id);
      if (isPlaceholderDomain({ domain: company.domain })) continue;
      combined.push({ _id: company._id, name: company.name, domain: company.domain });
    }
    return combined;
  },
});

export const backfillCompanyProfilesFromCalls = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, numItems = 200 }) => {
    const page = await ctx.db.query("calls").paginate({ cursor, numItems });
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const call of page.page) {
      if (!call.companyDomain) {
        skipped++;
        continue;
      }
      const startedAt = Date.parse(call.started);
      const result = await ensureCompanyProfileForActivity({
        ctx,
        domain: call.companyDomain,
        source: "gong",
        timestamp: Number.isNaN(startedAt) ? undefined : startedAt,
      });
      if (result.created) created++;
      else if (result.updated) updated++;
      else if (!result.companyId) skipped++;
    }

    return { done: page.isDone, cursor: page.continueCursor, scanned: page.page.length, created, updated, skipped };
  },
});

export const backfillCompanyProfilesFromPylonIssues = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.optional(v.number()) },
  handler: async (ctx, { cursor, numItems = 200 }) => {
    const page = await ctx.db.query("pylonIssues").paginate({ cursor, numItems });
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const issue of page.page) {
      if (!issue.companyDomain) {
        skipped++;
        continue;
      }
      const createdAt = Date.parse(issue.createdAt);
      const result = await ensureCompanyProfileForActivity({
        ctx,
        domain: issue.companyDomain,
        name: issue.companyName,
        source: "pylon",
        timestamp: Number.isNaN(createdAt) ? undefined : createdAt,
      });
      if (result.created) created++;
      else if (result.updated) updated++;
      else if (!result.companyId) skipped++;
    }

    return { done: page.isDone, cursor: page.continueCursor, scanned: page.page.length, created, updated, skipped };
  },
});

export const listCustomersWithNoActivity = internalQuery({
  args: {},
  handler: async (ctx) => {
    const customers = await ctx.db
      .query("companyProfiles")
      .withIndex("by_status", (q) => q.eq("status", "customer"))
      .collect();

    const results: Array<{
      domain: string;
      name: string;
      acr: number;
      aliases: string[];
      callCount: number;
      ticketCount: number;
    }> = [];

    for (const company of customers) {
      // Skip profiles that are themselves aliases of another canonical domain
      const isAlias = await ctx.db
        .query("domainAliasIndex")
        .withIndex("by_alias", (q) => q.eq("alias", company.domain))
        .unique();
      if (isAlias) continue;

      const domains = [company.domain, ...(company.domainAliases ?? [])];

      let callCount = 0;
      let ticketCount = 0;
      for (const d of domains) {
        const call = await ctx.db
          .query("calls")
          .withIndex("by_company_started", (q) => q.eq("companyDomain", d))
          .first();
        if (call) { callCount++; break; }
      }
      for (const d of domains) {
        const ticket = await ctx.db
          .query("pylonIssues")
          .withIndex("by_company_created", (q) => q.eq("companyDomain", d))
          .first();
        if (ticket) { ticketCount++; break; }
      }

      if (callCount === 0 && ticketCount === 0) {
        results.push({
          domain: company.domain,
          name: company.name,
          acr: company.acr ?? 0,
          aliases: company.domainAliases ?? [],
          callCount: 0,
          ticketCount: 0,
        });
      }
    }

    return results.sort((a, b) => b.acr - a.acr);
  },
});

export const checkDomainActivity = internalQuery({
  args: { domains: v.array(v.string()) },
  handler: async (ctx, { domains }) => {
    const results: Array<{ domain: string; calls: number; tickets: number }> = [];
    for (const domain of domains) {
      const calls = await ctx.db
        .query("calls")
        .withIndex("by_company_started", (q) => q.eq("companyDomain", domain))
        .take(200);
      const tickets = await ctx.db
        .query("pylonIssues")
        .withIndex("by_company_created", (q) => q.eq("companyDomain", domain))
        .take(200);
      results.push({ domain, calls: calls.length, tickets: tickets.length });
    }
    return results;
  },
});

export const debugRevenueCoverageOffenders = internalQuery({
  args: {
    limit: v.optional(v.number()),
    minAcr: v.optional(v.number()),
    minLifetimeRevenue: v.optional(v.number()),
    minYearRevenue: v.optional(v.number()),
    revenueYear: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      limit = 25,
      minAcr = 100_000,
      minLifetimeRevenue = 100_000,
      minYearRevenue = 100_000,
      revenueYear = new Date().getUTCFullYear(),
    },
  ) => {
    const customers = await ctx.db
      .query("companyProfiles")
      .withIndex("by_status", (q) => q.eq("status", "customer"))
      .collect();

    type Offender = {
      domain: string;
      name: string;
      acr: number;
      lifetimeRevenue: number;
      yearRevenue: number;
      revenueYear: number;
      offenderScore: number;
      aliases: string[];
      sources: string[];
      callCount: number;
      ticketCount: number;
      revenueDealCount: number;
      lastCallAt: string | null;
      lastTicketAt: string | null;
      lastRevenueAt: string | null;
      missing: Array<"calls" | "tickets">;
    };

    const bigCompanies: Offender[] = [];

    for (const company of customers) {
      const isAlias = await ctx.db
        .query("domainAliasIndex")
        .withIndex("by_alias", (q) => q.eq("alias", company.domain))
        .unique();
      if (isAlias) continue;

      const domains = allDomains(company);
      const callArrays = await Promise.all(
        domains.map((domain) =>
          ctx.db
            .query("calls")
            .withIndex("by_company_started", (q) => q.eq("companyDomain", domain))
            .collect()
        )
      );
      const ticketArrays = await Promise.all(
        domains.map((domain) =>
          ctx.db
            .query("pylonIssues")
            .withIndex("by_company_created", (q) => q.eq("companyDomain", domain))
            .collect()
        )
      );
      const dealArrays = await Promise.all(
        domains.map((domain) =>
          ctx.db
            .query("companyRevenueDeals")
            .withIndex("by_domain", (q) => q.eq("domain", domain))
            .collect()
        )
      );

      const calls = callArrays.flat();
      const tickets = ticketArrays.flat();
      const deals = dealArrays.flat();
      const acr = company.acr ?? 0;
      const lifetimeRevenue = deals.reduce((sum, deal) => sum + deal.amount, 0);
      const yearRevenue = deals
        .filter((deal) => deal.year === revenueYear)
        .reduce((sum, deal) => sum + deal.amount, 0);

      const isBig =
        acr >= minAcr ||
        lifetimeRevenue >= minLifetimeRevenue ||
        yearRevenue >= minYearRevenue;
      if (!isBig) continue;

      const missing: Array<"calls" | "tickets"> = [];
      if (calls.length === 0) missing.push("calls");
      if (tickets.length === 0) missing.push("tickets");
      if (missing.length === 0) continue;

      bigCompanies.push({
        domain: company.domain,
        name: company.name,
        acr,
        lifetimeRevenue,
        yearRevenue,
        revenueYear,
        offenderScore: Math.max(acr, lifetimeRevenue, yearRevenue),
        aliases: company.domainAliases ?? [],
        sources: company.sources,
        callCount: calls.length,
        ticketCount: tickets.length,
        revenueDealCount: deals.length,
        lastCallAt: calls.sort((a, b) => b.started.localeCompare(a.started))[0]?.started ?? null,
        lastTicketAt: tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? null,
        lastRevenueAt: deals.sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null,
        missing,
      });
    }

    const sorted = bigCompanies.sort((a, b) => b.offenderScore - a.offenderScore);

    return {
      thresholds: { minAcr, minLifetimeRevenue, minYearRevenue, revenueYear },
      totals: {
        customers: customers.length,
        bigCustomers: sorted.length,
        noCalls: sorted.filter((company) => company.callCount === 0).length,
        noTickets: sorted.filter((company) => company.ticketCount === 0).length,
        noActivity: sorted.filter((company) => company.callCount === 0 && company.ticketCount === 0).length,
      },
      topNoCalls: sorted.filter((company) => company.callCount === 0).slice(0, limit),
      topNoTickets: sorted.filter((company) => company.ticketCount === 0).slice(0, limit),
      topNoActivity: sorted
        .filter((company) => company.callCount === 0 && company.ticketCount === 0)
        .slice(0, limit),
      topOffenders: sorted.slice(0, limit),
    };
  },
});

export const listCompaniesWithYearRevenueAboveAcrInternal = internalQuery({
  args: {
    revenueYear: v.number(),
    limit: v.optional(v.number()),
    minDifference: v.optional(v.number()),
  },
  handler: async (ctx, { revenueYear, limit = 100, minDifference = 0 }) => {
    type DealSummary = {
      domain: string;
      date: string;
      amount: number;
      opportunityName: string;
      opportunityType: "Net New" | "Expansion" | "Renewal";
      category: "inference" | "gpu_cluster" | "credits_other";
      label: string;
    };

    type CompanyRevenueMismatch = {
      domain: string;
      name: string;
      acr: number;
      yearRevenue: number;
      difference: number;
      revenueYear: number;
      revenueDealCount: number;
      aliases: string[];
      deals: DealSummary[];
    };

    const mismatches: CompanyRevenueMismatch[] = [];
    const allYearDeals = await ctx.db
      .query("companyRevenueDeals")
      .withIndex("by_year", (q) => q.eq("year", revenueYear))
      .collect();

    const dealsByProfileId = new Map<string, { profile: NonNullable<Awaited<ReturnType<typeof resolveProfile>>>; deals: typeof allYearDeals }>();
    const profileByDomain = new Map<string, NonNullable<Awaited<ReturnType<typeof resolveProfile>>> | null>();

    for (const deal of allYearDeals) {
      let profile = profileByDomain.get(deal.domain);
      if (profile === undefined) {
        profile = await resolveProfile(ctx.db, deal.domain);
        profileByDomain.set(deal.domain, profile);
      }
      if (!profile) continue;

      const existing = dealsByProfileId.get(profile._id);
      if (existing) {
        existing.deals.push(deal);
      } else {
        dealsByProfileId.set(profile._id, { profile, deals: [deal] });
      }
    }

    for (const { profile: company, deals: unsortedDeals } of dealsByProfileId.values()) {
      const deals = unsortedDeals.sort((a, b) => b.date.localeCompare(a.date));
      const yearRevenue = deals.reduce((sum, deal) => sum + deal.amount, 0);
      const acr = company.acr ?? 0;
      const difference = yearRevenue - acr;

      if (difference <= minDifference) continue;

      mismatches.push({
        domain: company.domain,
        name: company.name,
        acr,
        yearRevenue,
        difference,
        revenueYear,
        revenueDealCount: deals.length,
        aliases: company.domainAliases ?? [],
        deals: deals.map((deal) => ({
          domain: deal.domain,
          date: deal.date,
          amount: deal.amount,
          opportunityName: deal.opportunityName,
          opportunityType: deal.opportunityType,
          category: deal.category,
          label: deal.label,
        })),
      });
    }

    const results = mismatches
      .sort((a, b) => b.difference - a.difference)
      .slice(0, limit);

    return {
      revenueYear,
      minDifference,
      totalMismatches: mismatches.length,
      returned: results.length,
      results,
    };
  },
});

// One-off backfill: computes lastActivityAt for existing companyProfiles from
// their current calls/tickets (including domain aliases). New ingest writes
// keep this field up to date going forward via bumpCompanyLastActivity.
export const backfillLastActivity = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("companyProfiles").paginate({ cursor, numItems: 50 });

    let updated = 0;
    for (const profile of page.page) {
      let latest = 0;
      for (const domain of allDomains(profile)) {
        const [call, ticket] = await Promise.all([
          ctx.db
            .query("calls")
            .withIndex("by_company_started", (q) => q.eq("companyDomain", domain))
            .order("desc")
            .first(),
          ctx.db
            .query("pylonIssues")
            .withIndex("by_company_created", (q) => q.eq("companyDomain", domain))
            .order("desc")
            .first(),
        ]);
        if (call) latest = Math.max(latest, Date.parse(call.started) || 0);
        if (ticket) latest = Math.max(latest, Date.parse(ticket.createdAt) || 0);
      }

      if (latest > 0 && latest !== (profile.lastActivityAt ?? 0)) {
        await ctx.db.patch(profile._id, { lastActivityAt: latest });
        updated++;
      }
    }

    console.log(`[backfill] lastActivityAt updated=${updated}/${page.page.length} done=${page.isDone}`);
    return { done: page.isDone, cursor: page.continueCursor };
  },
});

// One-off backfill: precomputes companyProfiles.lifetimeRevenue and
// revenueCategories for existing companies from companyRevenueDeals across
// their domain and domain aliases. Going forward, incrementCompanyLifetimeRevenue
// and addCompanyRevenueCategory keep these in sync as new deals are inserted
// (see insertCompanyRevenueDealsInternal, bumpCompanyLifetimeRevenueInternal,
// and addCompanyRevenueCategoryInternal).
export const backfillLifetimeRevenue = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("companyProfiles").paginate({ cursor, numItems: 50 });

    let updated = 0;
    for (const profile of page.page) {
      // Skip alias profiles — their deals are summed under the canonical domain.
      const isAlias = await ctx.db
        .query("domainAliasIndex")
        .withIndex("by_alias", (q) => q.eq("alias", profile.domain))
        .unique();
      if (isAlias) continue;

      const dealArrays = await Promise.all(
        allDomains(profile).map((domain) =>
          ctx.db
            .query("companyRevenueDeals")
            .withIndex("by_domain", (q) => q.eq("domain", domain))
            .collect()
        )
      );
      const deals = dealArrays.flat();
      const lifetimeRevenue = deals
        .filter((deal) => deal.year < LIFETIME_REVENUE_CUTOFF_YEAR)
        .reduce((sum, deal) => sum + deal.amount, 0);
      const revenueCategories = [...new Set(deals.map((deal) => deal.category))];

      const categoriesChanged =
        revenueCategories.length !== (profile.revenueCategories ?? []).length ||
        revenueCategories.some((category) => !(profile.revenueCategories ?? []).includes(category));

      if (lifetimeRevenue !== (profile.lifetimeRevenue ?? 0) || categoriesChanged) {
        await ctx.db.patch(profile._id, { lifetimeRevenue, revenueCategories });
        updated++;
      }
    }

    console.log(`[backfill] lifetimeRevenue/revenueCategories updated=${updated}/${page.page.length} done=${page.isDone}`);
    return { done: page.isDone, cursor: page.continueCursor };
  },
});

// Internal utility for future deal-import paths: adds `amount` to the
// resolved company's lifetimeRevenue (handling domain aliases). Call this
// whenever new revenue deals are inserted outside of
// insertCompanyRevenueDealsInternal so the precomputed total stays in sync.
export const bumpCompanyLifetimeRevenueInternal = internalMutation({
  args: { domain: v.string(), amount: v.number(), year: v.number() },
  handler: async (ctx, { domain, amount, year }) => {
    await incrementCompanyLifetimeRevenue({ ctx, domain, amount, year });
  },
});

// Internal utility for future deal-import paths: adds `category` to the
// resolved company's revenueCategories (handling domain aliases). Call this
// whenever new revenue deals are inserted outside of
// insertCompanyRevenueDealsInternal so the precomputed category list stays in
// sync.
export const addCompanyRevenueCategoryInternal = internalMutation({
  args: {
    domain: v.string(),
    category: v.union(v.literal("inference"), v.literal("gpu_cluster"), v.literal("credits_other")),
  },
  handler: async (ctx, { domain, category }) => {
    await addCompanyRevenueCategory({ ctx, domain, category });
  },
});

// ─── list / search ───────────────────────────────────────────────────────────

export const listCompanies = query({
  args: {
    status: v.optional(v.union(
      v.literal("customer"),
      v.literal("prospect"),
      v.literal("former_customer"),
      v.literal("unknown"),
    )),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    sortBy: v.optional(v.union(v.literal("acr"), v.literal("lifetimeRevenue"), v.literal("name"), v.literal("activity"))),
    sortDir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    revenueYear: v.optional(v.number()),
    revenueCategory: v.optional(v.union(v.literal("inference"), v.literal("gpu_cluster"), v.literal("credits_other"))),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { status, search, limit = 50, sortBy = "activity", sortDir = "desc", revenueYear, revenueCategory, serverSecret }) => {
    await requireAuthenticated({ ctx, serverSecret });

    let revenueProfileIds: Set<string> | null = null;
    if (revenueYear !== undefined) {
      const deals = await ctx.db
        .query("companyRevenueDeals")
        .withIndex("by_year", (q) => q.eq("year", revenueYear))
        .collect();
      revenueProfileIds = new Set<string>();
      for (const deal of deals) {
        if (revenueCategory && deal.category !== revenueCategory) continue;
        const profile = await resolveProfile(ctx.db, deal.domain);
        if (profile) revenueProfileIds.add(profile._id);
      }
    }
    const byRevenue = <T extends { _id: string; revenueCategories?: Array<"inference" | "gpu_cluster" | "credits_other"> }>(companies: T[]): T[] =>
      companies.filter((company) => {
        if (revenueProfileIds && !revenueProfileIds.has(company._id)) return false;
        if (revenueYear === undefined && revenueCategory && !(company.revenueCategories ?? []).includes(revenueCategory)) return false;
        return true;
      });

    // Hide companies with no calls, no tickets, and no revenue deals.
    const isActive = <T extends { lastActivityAt?: number; revenueCategories?: Array<"inference" | "gpu_cluster" | "credits_other"> }>(companies: T[]): T[] =>
      companies.filter((c) => (c.lastActivityAt ?? 0) > 0 || (c.revenueCategories?.length ?? 0) > 0);

    if (search && search.trim().length > 0) {
      // Search always spans every status — restricting to the active tab's
      // status here would hide matches that live in a different category
      // (e.g. searching while on "Customers" hides a matching prospect).
      const results = await ctx.db
        .query("companyProfiles")
        .withSearchIndex("by_name", (q) => q.search("name", search.trim()))
        .take(limit);
      return sortCompanyProfiles({ companies: isActive(byRevenue(results)), sortBy, sortDir });
    }

    if (sortBy === "acr") {
      if (status) {
        const filtered = await ctx.db
          .query("companyProfiles")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect();
        return sortCompanyProfiles({ companies: isActive(byRevenue(filtered)), sortBy, sortDir }).slice(0, limit);
      }
      if (revenueProfileIds || revenueCategory) {
        const all = await ctx.db.query("companyProfiles").withIndex("by_acr").order(sortDir).collect();
        return isActive(byRevenue(all)).slice(0, limit);
      }
      const allAcr = await ctx.db.query("companyProfiles").withIndex("by_acr").order(sortDir).collect();
      return isActive(allAcr).slice(0, limit);
    }

    if (sortBy === "lifetimeRevenue") {
      if (status) {
        const filtered = await ctx.db
          .query("companyProfiles")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect();
        return sortCompanyProfiles({ companies: isActive(byRevenue(filtered)), sortBy, sortDir }).slice(0, limit);
      }
      if (revenueProfileIds || revenueCategory) {
        const all = await ctx.db.query("companyProfiles").withIndex("by_lifetime_revenue").order(sortDir).collect();
        return isActive(byRevenue(all)).slice(0, limit);
      }
      const allLtv = await ctx.db.query("companyProfiles").withIndex("by_lifetime_revenue").order(sortDir).collect();
      return isActive(allLtv).slice(0, limit);
    }

    if (sortBy === "name") {
      if (status) {
        const filtered = await ctx.db
          .query("companyProfiles")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect();
        return sortCompanyProfiles({ companies: isActive(byRevenue(filtered)), sortBy, sortDir }).slice(0, limit);
      }
      if (revenueProfileIds || revenueCategory) {
        const all = await ctx.db.query("companyProfiles").withIndex("by_company_name").order(sortDir).collect();
        return isActive(byRevenue(all)).slice(0, limit);
      }
      const allByName = await ctx.db.query("companyProfiles").withIndex("by_company_name").order(sortDir).collect();
      return isActive(allByName).slice(0, limit);
    }

    // sortBy === "activity"
    if (status) {
      const filtered = await ctx.db
        .query("companyProfiles")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      return sortCompanyProfiles({ companies: isActive(byRevenue(filtered)), sortBy, sortDir }).slice(0, limit);
    }
    if (revenueProfileIds || revenueCategory) {
      const all = await ctx.db.query("companyProfiles").withIndex("by_last_activity").order(sortDir).collect();
      return isActive(byRevenue(all)).slice(0, limit);
    }
    const allByActivity = await ctx.db.query("companyProfiles").withIndex("by_last_activity").order(sortDir).collect();
    return isActive(allByActivity).slice(0, limit);
  },
});

// ─── stats ───────────────────────────────────────────────────────────────────

export const getCompanyStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticated({ ctx });
    const all = await ctx.db.query("companyProfiles").collect();
    const total = all.filter((c) => c.status !== "prospect").length;
    const customers = all.filter((c) => c.status === "customer").length;
    return { total, customers };
  },
});

// ─── single company (alias-aware, unified counts) ────────────────────────────

export const getCompany = query({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => {
    await requireAuthenticated({ ctx });
    const profile = await resolveProfile(ctx.db, domain);
    if (!profile) return null;

    const domains = allDomains(profile);
    const [callArrays, ticketArrays, dealArrays] = await Promise.all([
      Promise.all(
        domains.map((d) =>
          ctx.db
            .query("calls")
            .withIndex("by_company_started", (q) => q.eq("companyDomain", d))
            .order("desc")
            .take(200)
        )
      ),
      Promise.all(
        domains.map((d) =>
          ctx.db
            .query("pylonIssues")
            .withIndex("by_company_created", (q) => q.eq("companyDomain", d))
            .order("desc")
            .take(200)
        )
      ),
      Promise.all(
        domains.map((d) =>
          ctx.db
            .query("companyRevenueDeals")
            .withIndex("by_domain", (q) => q.eq("domain", d))
            .collect()
        )
      ),
    ]);

    const calls = callArrays.flat().sort((a, b) => b.started.localeCompare(a.started));
    const tickets = ticketArrays.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const deals = dealArrays.flat();

    return {
      ...profile,
      callCount: calls.length,
      ticketCount: tickets.length,
      lastCallAt: calls[0]?.started ?? null,
      lastTicketAt: tickets[0]?.createdAt ?? null,
      revenueDealCount: deals.length,
      revenueTotal: deals.reduce((sum, deal) => sum + deal.amount, 0),
    };
  },
});

export const getCompanyActivity = query({
  args: {
    domain: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { domain, limit = 20 }) => {
    await requireAuthenticated({ ctx });
    const profile = await resolveProfile(ctx.db, domain);
    if (!profile) return { calls: [], tickets: [] };

    const domains = allDomains(profile);
    const [callArrays, ticketArrays] = await Promise.all([
      Promise.all(
        domains.map((d) =>
          ctx.db
            .query("calls")
            .withIndex("by_company_started", (q) => q.eq("companyDomain", d))
            .order("desc")
            .take(limit)
        )
      ),
      Promise.all(
        domains.map((d) =>
          ctx.db
            .query("pylonIssues")
            .withIndex("by_company_created", (q) => q.eq("companyDomain", d))
            .order("desc")
            .take(limit)
        )
      ),
    ]);

    return {
      calls: callArrays.flat().sort((a, b) => b.started.localeCompare(a.started)).slice(0, limit),
      tickets: ticketArrays.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit),
    };
  },
});

// One-off cleanup for alias companyProfiles rows left behind by merges that
// ran before mergeDomainsIntoCanonical started deleting them.
export const cleanupOrphanedAliasProfiles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const aliasEntries = await ctx.db.query("domainAliasIndex").collect();
    const aliasesByPrimary = new Map<string, string[]>();
    for (const entry of aliasEntries) {
      const aliases = aliasesByPrimary.get(entry.primaryDomain) ?? [];
      aliases.push(entry.alias);
      aliasesByPrimary.set(entry.primaryDomain, aliases);
    }

    const results: Array<{ primary: string; aliases: string[] }> = [];
    for (const [primaryDomain, aliasDomains] of aliasesByPrimary) {
      let foundOrphan = false;
      for (const aliasDomain of aliasDomains) {
        const aliasProfile = await ctx.db
          .query("companyProfiles")
          .withIndex("by_domain", (q) => q.eq("domain", aliasDomain))
          .unique();
        if (aliasProfile) {
          foundOrphan = true;
          break;
        }
      }
      if (!foundOrphan) continue;

      const result = await mergeDomainsIntoCanonical(ctx, { suggestedPrimary: primaryDomain, aliasDomains });
      results.push(result);
    }

    return { cleaned: results.length, results };
  },
});

// One-off admin fix: corrects a companyProfiles row's domain/website when the
// import pipeline matched it to the wrong real-world domain (e.g. a Clay/Salesforce
// enrichment that resolved a company's website to an unrelated business).
export const fixCompanyProfileDomainInternal = internalMutation({
  args: {
    companyId: v.id("companyProfiles"),
    domain: v.string(),
    website: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, domain, website }) => {
    const existing = await ctx.db
      .query("companyProfiles")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .unique();
    if (existing && existing._id !== companyId) throw new Error(`Domain ${domain} is already used by another company profile`);

    await ctx.db.patch(companyId, { domain, website, updatedAt: Date.now() });
  },
});

// One-off: merges sales-wins data (ACR, sources, status, name fixes) into
// existing companyProfiles for the 13 domain-collision wins, and creates new
// profiles for the 2 wins whose Exa-resolved domain was bogus.
export const applySalesWinsMergesInternal = internalMutation({
  args: {
    merges: v.array(v.object({
      domain: v.string(),
      acr: v.optional(v.number()),
      newStatus: v.optional(v.union(
        v.literal("customer"),
        v.literal("prospect"),
        v.literal("former_customer"),
        v.literal("unknown"),
      )),
      newName: v.optional(v.string()),
    })),
    creates: v.array(v.object({
      domain: v.string(),
      name: v.string(),
      status: v.union(
        v.literal("customer"),
        v.literal("prospect"),
        v.literal("former_customer"),
        v.literal("unknown"),
      ),
      acr: v.optional(v.number()),
    })),
  },
  handler: async (ctx, { merges, creates }) => {
    const now = Date.now();
    const log: string[] = [];

    for (const m of merges) {
      const existing = await ctx.db
        .query("companyProfiles")
        .withIndex("by_domain", (q) => q.eq("domain", m.domain))
        .unique();
      if (!existing) {
        log.push(`MISSING: ${m.domain}`);
        continue;
      }
      await ctx.db.patch(existing._id, {
        name: m.newName ?? existing.name,
        status: m.newStatus ? mergeStatus(existing.status, m.newStatus) : existing.status,
        sources: existing.sources.includes("slack") ? existing.sources : ([...existing.sources, "slack"] as typeof existing.sources),
        acr: existing.acr ?? m.acr,
        updatedAt: now,
      });
      log.push(`MERGED: ${m.domain}`);
    }

    for (const c of creates) {
      const existing = await ctx.db
        .query("companyProfiles")
        .withIndex("by_domain", (q) => q.eq("domain", c.domain))
        .unique();
      if (existing) {
        log.push(`SKIP CREATE (exists): ${c.domain}`);
        continue;
      }
      await ctx.db.insert("companyProfiles", {
        domain: c.domain,
        name: c.name,
        status: c.status,
        sources: ["slack"],
        acr: c.acr,
        createdAt: now,
        updatedAt: now,
      });
      log.push(`CREATED: ${c.domain}`);
    }

    return log;
  },
});

// One-off: companies created from calls/tickets default to status "unknown"
// (see ensureCompanyProfileForActivity). Reclassifies them using signals we
// already store: revenue deals (-> customer), prospect-segment tracking,
// Clay's isPotentialCustomer flag, or a recorded Gong sales call (-> prospect).
// Companies whose domain is a personal email provider, or with no applicable
// signal (e.g. only ever appeared in a Pylon support ticket), are left
// "unknown". Pass dryRun: true to preview without patching.
export const classifyUnknownCompaniesInternal = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { dryRun = false }) => {
    const deals = await ctx.db.query("companyRevenueDeals").collect();
    const revenueByDomain = new Map<string, number>();
    for (const deal of deals) {
      revenueByDomain.set(deal.domain, (revenueByDomain.get(deal.domain) ?? 0) + deal.amount);
    }

    const unknownCompanies = await ctx.db
      .query("companyProfiles")
      .withIndex("by_status", (q) => q.eq("status", "unknown"))
      .collect();

    const now = Date.now();
    const changes: { domain: string; name: string; to: "customer" | "prospect"; reason: string }[] = [];

    for (const profile of unknownCompanies) {
      const domains = [profile.domain, ...(profile.domainAliases ?? [])];
      const totalRevenue = domains.reduce((sum, domain) => sum + (revenueByDomain.get(domain) ?? 0), 0);

      const membership = await ctx.db
        .query("companySegmentMemberships")
        .withIndex("by_company", (q) => q.eq("companyId", profile._id))
        .first();

      const classification = classifyUnknownCompany({
        profile,
        totalRevenue,
        hasSegmentMembership: membership !== null,
      });
      if (!classification) continue;

      changes.push({ domain: profile.domain, name: profile.name, to: classification.status, reason: classification.reason });
      if (!dryRun) {
        await ctx.db.patch(profile._id, { status: classification.status, updatedAt: now });
      }
    }

    return { checked: unknownCompanies.length, reclassified: changes.length, dryRun, changes };
  },
});

// One-off cleanup: deletes companyProfiles whose domain is a free
// webmail/ISP provider (see PERSONAL_EMAIL_DOMAINS in lib/convex/companies.ts).
// These are leftovers from call/ticket participants whose only email was a
// personal address — they aren't real companies. As a safety net, skips any
// matching profile that has lifetime revenue or revenue categories recorded.
// Pass dryRun: true to preview without deleting.
export const deletePersonalEmailCompanyProfilesInternal = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { dryRun = false }) => {
    const all = await ctx.db.query("companyProfiles").collect();
    const matches: { domain: string; name: string; status: string }[] = [];
    const skipped: { domain: string; name: string; reason: string }[] = [];

    for (const profile of all) {
      if (!isPersonalEmailDomain({ domain: profile.domain })) continue;
      if ((profile.lifetimeRevenue ?? 0) > 0 || (profile.revenueCategories?.length ?? 0) > 0) {
        skipped.push({ domain: profile.domain, name: profile.name, reason: "has revenue recorded" });
        continue;
      }

      matches.push({ domain: profile.domain, name: profile.name, status: profile.status });
      if (!dryRun) await ctx.db.delete(profile._id);
    }

    return { deleted: dryRun ? 0 : matches.length, dryRun, matches, skipped };
  },
});

// One-off: the sales-wins Slack import only writes companyRevenueDeals rows,
// it doesn't update companyProfiles.status. Promotes any "prospect" company
// that has revenue (across its domain or domain aliases) above minAmount to
// "customer". Pass dryRun: true to preview without patching.
export const promoteProspectsWithRevenueInternal = internalMutation({
  args: {
    minAmount: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { minAmount = 0, dryRun = false }) => {
    const deals = await ctx.db.query("companyRevenueDeals").collect();
    const revenueByDomain = new Map<string, number>();
    for (const deal of deals) {
      revenueByDomain.set(deal.domain, (revenueByDomain.get(deal.domain) ?? 0) + deal.amount);
    }

    const prospects = await ctx.db
      .query("companyProfiles")
      .withIndex("by_status", (q) => q.eq("status", "prospect"))
      .collect();

    const now = Date.now();
    const promoted: { domain: string; name: string; revenue: number }[] = [];

    for (const company of prospects) {
      const domains = [company.domain, ...(company.domainAliases ?? [])];
      const revenue = domains.reduce((sum, domain) => sum + (revenueByDomain.get(domain) ?? 0), 0);
      if (revenue > minAmount) {
        promoted.push({ domain: company.domain, name: company.name, revenue });
        if (!dryRun) {
          await ctx.db.patch(company._id, { status: "customer", updatedAt: now });
        }
      }
    }

    return { checked: prospects.length, promoted: promoted.length, dryRun, companies: promoted };
  },
});

// One-off: backfills/refreshes companyProfiles.acr from the per-company
// "currentAcr" figures in the sales-wins Slack export
// (data/slack-exports/sales-wins-by-company.json), which was never imported
// when companyRevenueDeals were added. Resolves domain aliases via
// resolveProfile. Pass dryRun: true to preview without patching.
export const updateCompanyAcrFromSalesWinsInternal = internalMutation({
  args: {
    records: v.array(v.object({ domain: v.string(), acr: v.number() })),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { records, dryRun = false }) => {
    const now = Date.now();
    const changes: { domain: string; previousAcr: number | null; newAcr: number }[] = [];
    const notFound: string[] = [];

    for (const { domain, acr } of records) {
      const profile = await resolveProfile(ctx.db, domain);
      if (!profile) {
        notFound.push(domain);
        continue;
      }
      if (profile.acr === acr) continue;

      changes.push({ domain: profile.domain, previousAcr: profile.acr ?? null, newAcr: acr });
      if (!dryRun) {
        await ctx.db.patch(profile._id, { acr, updatedAt: now });
      }
    }

    return { checked: records.length, updated: changes.length, notFound, dryRun, changes };
  },
});

// ─── ACR suggestions (admin) ────────────────────────────────────────────────

export const proposeAcrSuggestionsInternal = internalMutation({
  args: {
    suggestions: v.array(v.object({
      domain: v.string(),
      proposedAcr: v.number(),
      reason: v.union(v.literal("flagged_review"), v.literal("near_zero")),
      confidence: v.optional(v.string()),
    })),
  },
  handler: async (ctx, { suggestions }) => {
    const now = Date.now();
    let inserted = 0;
    let skipped = 0;

    for (const s of suggestions) {
      const profile = await resolveProfile(ctx.db, s.domain);
      if (!profile || profile.acr === s.proposedAcr) {
        skipped++;
        continue;
      }

      const existing = await ctx.db
        .query("acrSuggestions")
        .withIndex("by_domain", (q) => q.eq("domain", profile.domain))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();
      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert("acrSuggestions", {
        domain: profile.domain,
        name: profile.name,
        currentAcr: profile.acr,
        proposedAcr: s.proposedAcr,
        reason: s.reason,
        confidence: s.confidence,
        status: "pending",
        detectedAt: now,
      });
      inserted++;
    }

    return { inserted, skipped };
  },
});

export const listAcrSuggestions = query({
  args: {
    status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
  },
  handler: async (ctx, { status }) => {
    await requireAdmin({ ctx });
    const suggestions = status
      ? await ctx.db.query("acrSuggestions").withIndex("by_status", (q) => q.eq("status", status)).collect()
      : await ctx.db.query("acrSuggestions").collect();
    return suggestions.sort((a, b) => b.proposedAcr - a.proposedAcr);
  },
});

export const approveAcrSuggestion = mutation({
  args: { suggestionId: v.id("acrSuggestions") },
  handler: async (ctx, { suggestionId }) => {
    const email = await requireAdmin({ ctx });
    const suggestion = await ctx.db.get(suggestionId);
    if (!suggestion || suggestion.status !== "pending") throw new Error("Suggestion not found or already resolved");

    const profile = await ctx.db
      .query("companyProfiles")
      .withIndex("by_domain", (q) => q.eq("domain", suggestion.domain))
      .unique();
    if (!profile) throw new Error(`No company profile found for domain ${suggestion.domain}`);

    const now = Date.now();
    await ctx.db.patch(profile._id, { acr: suggestion.proposedAcr, updatedAt: now });
    await ctx.db.patch(suggestionId, { status: "approved", resolvedAt: now, resolvedByEmail: email });
  },
});

export const rejectAcrSuggestion = mutation({
  args: { suggestionId: v.id("acrSuggestions") },
  handler: async (ctx, { suggestionId }) => {
    const email = await requireAdmin({ ctx });
    const suggestion = await ctx.db.get(suggestionId);
    if (!suggestion || suggestion.status !== "pending") throw new Error("Suggestion not found or already resolved");
    await ctx.db.patch(suggestionId, { status: "rejected", resolvedAt: Date.now(), resolvedByEmail: email });
  },
});

// One-off admin merge: moves all companyRevenueDeals from fromDomain to toDomain,
// carries over lifetimeRevenue/revenueCategories/name, then calls
// mergeDomainsIntoCanonical to merge the profiles and delete the stale one.
export const mergeCompanyDomainsInternal = internalMutation({
  args: { fromDomain: v.string(), toDomain: v.string() },
  handler: async (ctx, { fromDomain, toDomain }) => {
    const from = await ctx.db
      .query("companyProfiles")
      .withIndex("by_domain", (q) => q.eq("domain", fromDomain))
      .unique();
    if (!from) throw new Error(`No profile found for fromDomain: ${fromDomain}`);

    const to = await ctx.db
      .query("companyProfiles")
      .withIndex("by_domain", (q) => q.eq("domain", toDomain))
      .unique();
    if (!to) throw new Error(`No profile found for toDomain: ${toDomain}`);

    // Move all revenue deals from the old domain to the new one.
    const deals = await ctx.db
      .query("companyRevenueDeals")
      .withIndex("by_domain", (q) => q.eq("domain", fromDomain))
      .collect();
    for (const deal of deals) {
      await ctx.db.patch(deal._id, { domain: toDomain });
    }

    // Carry over lifetimeRevenue and revenueCategories that aren't yet on toDomain.
    const mergedRevenue = (to.lifetimeRevenue ?? 0) + (from.lifetimeRevenue ?? 0);
    const existingCats = new Set(to.revenueCategories ?? []);
    for (const cat of from.revenueCategories ?? []) existingCats.add(cat);

    // Use the better-capitalised name if toDomain's name looks like a lowercased slug.
    const betterName = from.name.length >= to.name.length ? from.name : to.name;

    await ctx.db.patch(to._id, {
      lifetimeRevenue: mergedRevenue > 0 ? mergedRevenue : undefined,
      revenueCategories: existingCats.size > 0 ? [...existingCats] as typeof to.revenueCategories : undefined,
      name: betterName,
      updatedAt: Date.now(),
    });

    // mergeDomainsIntoCanonical merges status, acr, sources, segments, etc.
    // and deletes the fromDomain profile.
    await mergeDomainsIntoCanonical(ctx, { suggestedPrimary: toDomain, aliasDomains: [fromDomain] });

    return { movedDeals: deals.length, mergedRevenue, betterName };
  },
});
