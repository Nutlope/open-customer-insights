import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { generateCompanyDescription, stripDescriptionPreamble } from "../lib/domain/enrichCompanyDescription";
import { isPlaceholderDomain } from "../lib/domain/placeholderDomain";
import { selectTopCompaniesByActivityAndRevenue } from "../lib/convex/companies";

export const getCompanyForEnrichmentInternal = internalQuery({
  args: { companyId: v.id("companyProfiles") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get(companyId);
    if (!company) return null;
    return { name: company.name, domain: company.domain };
  },
});

// Companies missing a description, with a real (non-placeholder) domain, and
// a known status — "unknown" companies are skipped since classifyUnknownCompany
// (see lib/convex/companies.ts) should run first to give them a real status.
export const listCompaniesMissingDescriptionInternal = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 10 }) => {
    const all = await ctx.db.query("companyProfiles").collect();
    return all
      .filter(
        (company) =>
          !company.description &&
          company.status !== "unknown" &&
          !isPlaceholderDomain({ domain: company.domain })
      )
      .slice(0, limit)
      .map((company) => ({ _id: company._id, name: company.name, domain: company.domain }));
  },
});

export const patchCompanyDescriptionInternal = internalMutation({
  args: {
    companyId: v.id("companyProfiles"),
    description: v.string(),
  },
  handler: async (ctx, { companyId, description }) => {
    const now = Date.now();
    await ctx.db.patch(companyId, { description, enrichedAt: now, updatedAt: now });
  },
});

// One-off cleanup: some earlier descriptions kept the LLM's "Here is a 1-2
// sentence description of what X does:" preamble (see
// stripDescriptionPreamble). Re-cleans every stored description and patches
// any that change. Pass dryRun: true to preview without writing.
export const cleanupDescriptionPreamblesInternal = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { dryRun = false }) => {
    const all = await ctx.db.query("companyProfiles").collect();
    const changes: { domain: string; before: string; after: string }[] = [];

    for (const company of all) {
      if (!company.description) continue;
      const cleaned = stripDescriptionPreamble({ text: company.description });
      if (cleaned === company.description || !cleaned) continue;

      changes.push({ domain: company.domain, before: company.description, after: cleaned });
      if (!dryRun) {
        await ctx.db.patch(company._id, { description: cleaned, updatedAt: Date.now() });
      }
    }

    return { checked: all.length, updated: changes.length, dryRun, changes };
  },
});

// Generates and stores a description for a single company by reading its
// homepage via Exa and summarizing it with an LLM.
export const enrichCompanyDescriptionInternal = internalAction({
  args: { companyId: v.id("companyProfiles") },
  handler: async (ctx, { companyId }): Promise<{ domain: string; description: string | null } | null> => {
    const company = await ctx.runQuery(internal.enrichment.getCompanyForEnrichmentInternal, { companyId });
    if (!company || isPlaceholderDomain({ domain: company.domain })) return null;

    const description = await generateCompanyDescription({ name: company.name, domain: company.domain });
    if (description) {
      await ctx.runMutation(internal.enrichment.patchCompanyDescriptionInternal, { companyId, description });
    }
    return { domain: company.domain, description };
  },
});

// Companies missing a description (same eligibility as
// listCompaniesMissingDescriptionInternal), prioritized for enrichment via
// selectTopCompaniesByActivityAndRevenue: the `limitEach` most recently active
// companies, unioned with the `limitEach` companies with the highest lifetime
// revenue. Used to enrich the companies most likely to matter first, instead
// of an arbitrary table-order slice.
export const listEnrichmentCandidatesInternal = internalQuery({
  args: {
    limitEach: v.optional(v.number()),
  },
  handler: async (ctx, { limitEach = 100 }) => {
    const all = await ctx.db.query("companyProfiles").collect();
    const candidates = all.filter(
      (company) =>
        !company.description &&
        company.status !== "unknown" &&
        !isPlaceholderDomain({ domain: company.domain })
    );

    const combined = selectTopCompaniesByActivityAndRevenue({ companies: candidates, limitEach });
    return combined.map((company) => ({ _id: company._id, name: company.name, domain: company.domain }));
  },
});

// One-off backfill: fills in companyProfiles.description for the companies
// returned by listEnrichmentCandidatesInternal (most recently active +
// highest lifetime revenue, deduped). Pass dryRun: true to generate and
// preview descriptions without writing them. Run via
// `npx convex run enrichment:backfillEnrichmentCandidatesInternal '{"limitEach": 100}'`.
export const backfillEnrichmentCandidatesInternal = internalAction({
  args: {
    limitEach: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { limitEach = 100, dryRun = false }) => {
    const candidates: Array<{ _id: Id<"companyProfiles">; name: string; domain: string }> = await ctx.runQuery(
      internal.enrichment.listEnrichmentCandidatesInternal,
      { limitEach }
    );

    const results: { domain: string; name: string; description: string | null }[] = [];
    for (const company of candidates) {
      const description = await generateCompanyDescription({ name: company.name, domain: company.domain });
      if (description && !dryRun) {
        await ctx.runMutation(internal.enrichment.patchCompanyDescriptionInternal, {
          companyId: company._id,
          description,
        });
      }
      results.push({ domain: company.domain, name: company.name, description });
    }

    return { checked: candidates.length, dryRun, results };
  },
});

// One-off backfill: fills in companyProfiles.description for companies that
// don't have one yet (see listCompaniesMissingDescriptionInternal). Pass
// dryRun: true to generate and preview descriptions without writing them.
// Run in small batches via `npx convex run enrichment:backfillCompanyDescriptionsInternal '{"limit": 10}'`.
export const backfillCompanyDescriptionsInternal = internalAction({
  args: {
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { limit = 10, dryRun = false }) => {
    const candidates: Array<{ _id: Id<"companyProfiles">; name: string; domain: string }> = await ctx.runQuery(
      internal.enrichment.listCompaniesMissingDescriptionInternal,
      { limit }
    );

    const results: { domain: string; name: string; description: string | null }[] = [];
    for (const company of candidates) {
      const description = await generateCompanyDescription({ name: company.name, domain: company.domain });
      if (description && !dryRun) {
        await ctx.runMutation(internal.enrichment.patchCompanyDescriptionInternal, {
          companyId: company._id,
          description,
        });
      }
      results.push({ domain: company.domain, name: company.name, description });
    }

    return { checked: candidates.length, dryRun, results };
  },
});
