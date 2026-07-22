import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "../../convex/_generated/server";

export type CompanySortBy = "acr" | "lifetimeRevenue" | "name" | "activity";
export type CompanySortDir = "asc" | "desc";
export type CompanySource = Doc<"companyProfiles">["sources"][number];

// Deals dated this year or later are excluded from lifetimeRevenue for now —
// they represent forward-looking commitments rather than realized revenue.
export const LIFETIME_REVENUE_CUTOFF_YEAR = 2027;

export function sortCompanyProfiles({
  companies,
  sortBy,
  sortDir,
}: {
  companies: Doc<"companyProfiles">[];
  sortBy: CompanySortBy;
  sortDir: CompanySortDir;
}): Doc<"companyProfiles">[] {
  const dir = sortDir === "asc" ? 1 : -1;
  if (sortBy === "acr") {
    return [...companies].sort((a, b) => dir * ((a.acr ?? 0) - (b.acr ?? 0)));
  }
  if (sortBy === "lifetimeRevenue") {
    return [...companies].sort((a, b) => dir * ((a.lifetimeRevenue ?? 0) - (b.lifetimeRevenue ?? 0)));
  }
  if (sortBy === "name") {
    return [...companies].sort((a, b) => dir * a.name.localeCompare(b.name));
  }
  return [...companies].sort((a, b) => dir * ((a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0)));
}

// Selects companies of interest for downstream batch jobs (enrichment
// prioritization, Slack-mention watchlists, etc.): the `limitEach` most
// recently active companies, unioned with the `limitEach` companies with the
// highest lifetime revenue, deduped by _id. Callers are expected to
// pre-filter `companies` (e.g. by status) before calling this.
export function selectTopCompaniesByActivityAndRevenue({
  companies,
  limitEach,
}: {
  companies: Doc<"companyProfiles">[];
  limitEach: number;
}): Doc<"companyProfiles">[] {
  const byRecentActivity = [...companies]
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
    .slice(0, limitEach);
  const byLifetimeRevenue = [...companies]
    .sort((a, b) => (b.lifetimeRevenue ?? 0) - (a.lifetimeRevenue ?? 0))
    .slice(0, limitEach);

  const seen = new Set<Id<"companyProfiles">>();
  const combined: Doc<"companyProfiles">[] = [];
  for (const company of [...byRecentActivity, ...byLifetimeRevenue]) {
    if (seen.has(company._id)) continue;
    seen.add(company._id);
    combined.push(company);
  }
  return combined;
}

export function normalizeCompanyDomain({ value }: { value?: string | null }): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  const domain = trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
    .replace(/[^a-z0-9.-]/g, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return null;
  }
  return domain;
}

// Free webmail / consumer ISP email providers that sometimes end up as a
// companyProfiles.domain when a call/ticket participant (or a Clay row) only
// has a personal address. These aren't real companies — ensureCompanyProfileForActivity
// and upsertCompanies skip them entirely, and classifyUnknownCompany leaves
// any pre-existing rows as "unknown" rather than promoting them based on
// revenue/segment signals.
//
// Deliberately excludes domains that are *also* a real company's corporate
// domain (e.g. zoho.com, naver.com, yandex.com, mail.ru, qq.com) — those are
// legitimate prospects/customers in their own right.
const PERSONAL_EMAIL_DOMAINS = new Set([
  // Major global webmail providers
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.it",
  "yahoo.ca",
  "yahoo.com.br",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "outlook.fr",
  "outlook.de",
  "outlook.es",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.es",
  "hotmail.it",
  "live.com",
  "live.fr",
  "live.co.uk",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "gmx.at",
  "gmx.ch",
  "web.de",
  "mail.com",
  "inbox.com",
  "yopmail.com",
  "mailinator.com",
  "fastmail.com",
  "fastmail.fm",
  "tutanota.com",
  "tutanota.de",
  "tuta.io",
  // ISP webmail — UK
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
  "blueyonder.co.uk",
  "ntlworld.com",
  // ISP webmail — US
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "cox.net",
  "bellsouth.net",
  "earthlink.net",
  "charter.net",
  "optonline.net",
  "windstream.net",
  "centurylink.net",
  // ISP webmail — FR
  "laposte.net",
  "orange.fr",
  "free.fr",
  "wanadoo.fr",
  "sfr.fr",
  "aliceadsl.fr",
  // ISP webmail — IT
  "libero.it",
  "virgilio.it",
  "alice.it",
  "tiscali.it",
  // ISP webmail — DE
  "t-online.de",
  "freenet.de",
  // ISP webmail — CZ
  "seznam.cz",
  "centrum.cz",
]);

export function isPersonalEmailDomain({ domain }: { domain: string }): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}

// Decides whether an "unknown" companyProfiles row should be reclassified,
// based on signals that are cheap to compute from data we already store:
// revenue deals (-> customer) and prospect-segment tracking or Clay's
// isPotentialCustomer flag (-> prospect). Returns null if no signal applies,
// in which case the company stays "unknown".
export function classifyUnknownCompany({
  profile,
  totalRevenue,
  hasSegmentMembership,
}: {
  profile: Doc<"companyProfiles">;
  totalRevenue: number;
  hasSegmentMembership: boolean;
}): { status: "customer" | "prospect"; reason: string } | null {
  if (profile.status !== "unknown") return null;
  if (isPersonalEmailDomain({ domain: profile.domain })) return null;

  if (totalRevenue > 0) {
    return { status: "customer", reason: "has revenue deals" };
  }
  if (hasSegmentMembership) {
    return { status: "prospect", reason: "tracked in a prospect segment" };
  }
  if (profile.isPotentialCustomer) {
    return { status: "prospect", reason: "flagged as a potential customer" };
  }
  if (profile.sources.includes("gong")) {
    return { status: "prospect", reason: "has a Gong sales call" };
  }
  return null;
}

export function companyNameFromDomain({ domain }: { domain: string }): string {
  const root = domain.split(".")[0] ?? domain;
  return root
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || domain;
}

function uniqueCompanySources({
  existing,
  next,
}: {
  existing: Doc<"companyProfiles">["sources"];
  next: Doc<"companyProfiles">["sources"];
}): Doc<"companyProfiles">["sources"] {
  return [...new Set([...existing, ...next])];
}

export async function ensureCompanyProfileForActivity({
  ctx,
  domain,
  name,
  source,
  timestamp,
}: {
  ctx: MutationCtx;
  domain: string;
  name?: string;
  source: CompanySource;
  timestamp?: number;
}): Promise<{ companyId: Id<"companyProfiles"> | null; created: boolean; updated: boolean }> {
  const normalizedDomain = normalizeCompanyDomain({ value: domain });
  if (!normalizedDomain) return { companyId: null, created: false, updated: false };
  if (isPersonalEmailDomain({ domain: normalizedDomain })) return { companyId: null, created: false, updated: false };

  const canonicalDomain = await resolveCanonicalDomain({ db: ctx.db, domain: normalizedDomain });
  const now = Date.now();
  const cleanedName = name?.trim();
  const finiteTimestamp = timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : undefined;
  const profile = await ctx.db
    .query("companyProfiles")
    .withIndex("by_domain", (q) => q.eq("domain", canonicalDomain))
    .unique();

  if (profile) {
    const nextSources = uniqueCompanySources({ existing: profile.sources, next: [source] });
    const patch: Partial<Doc<"companyProfiles">> = {};
    if (nextSources.length !== profile.sources.length) patch.sources = nextSources;
    if (finiteTimestamp !== undefined && (profile.lastActivityAt ?? 0) < finiteTimestamp) {
      patch.lastActivityAt = finiteTimestamp;
    }
    if (Object.keys(patch).length === 0) {
      return { companyId: profile._id, created: false, updated: false };
    }
    patch.updatedAt = now;
    await ctx.db.patch(profile._id, patch);
    return { companyId: profile._id, created: false, updated: true };
  }

  const companyId = await ctx.db.insert("companyProfiles", {
    domain: canonicalDomain,
    name: cleanedName || companyNameFromDomain({ domain: canonicalDomain }),
    status: "unknown",
    sources: [source],
    ...(finiteTimestamp !== undefined ? { lastActivityAt: finiteTimestamp } : {}),
    createdAt: now,
    updatedAt: now,
  });

  return { companyId, created: true, updated: false };
}

// Bumps companyProfiles.lastActivityAt for the given domain if the new
// timestamp is more recent than what's stored. Used by call/ticket ingest
// so the companies list can be sorted by last activity without N+1 queries.
export async function bumpCompanyLastActivity({
  ctx,
  domain,
  timestamp,
}: {
  ctx: MutationCtx;
  domain: string;
  timestamp: number;
}): Promise<void> {
  if (!Number.isFinite(timestamp)) return;

  const profile = await ctx.db
    .query("companyProfiles")
    .withIndex("by_domain", (q) => q.eq("domain", domain))
    .unique();
  if (!profile) return;
  if ((profile.lastActivityAt ?? 0) >= timestamp) return;

  await ctx.db.patch(profile._id, { lastActivityAt: timestamp });
}

// Resolves a domain to the canonical primary domain it should be stored
// under, following domainAliasIndex so ingested calls/tickets always land
// on the merged company rather than a stale alias domain.
export async function resolveCanonicalDomain({
  db,
  domain,
}: {
  db: DatabaseReader;
  domain: string;
}): Promise<string> {
  const aliasEntry = await db
    .query("domainAliasIndex")
    .withIndex("by_alias", (q) => q.eq("alias", domain))
    .unique();
  return aliasEntry?.primaryDomain ?? domain;
}

// Adds `amount` to companyProfiles.lifetimeRevenue for the company that owns
// `domain` (resolving domain aliases to the canonical profile first). Skips
// deals dated LIFETIME_REVENUE_CUTOFF_YEAR or later (see constant above).
// Used whenever a new companyRevenueDeals row is inserted so the precomputed
// lifetime revenue total stays in sync without a full recompute.
export async function incrementCompanyLifetimeRevenue({
  ctx,
  domain,
  amount,
  year,
}: {
  ctx: MutationCtx;
  domain: string;
  amount: number;
  year: number;
}): Promise<void> {
  if (!amount || year >= LIFETIME_REVENUE_CUTOFF_YEAR) return;

  const canonicalDomain = await resolveCanonicalDomain({ db: ctx.db, domain });
  const profile = await ctx.db
    .query("companyProfiles")
    .withIndex("by_domain", (q) => q.eq("domain", canonicalDomain))
    .unique();
  if (!profile) return;

  await ctx.db.patch(profile._id, {
    lifetimeRevenue: (profile.lifetimeRevenue ?? 0) + amount,
  });
}

// Adds `category` to companyProfiles.revenueCategories for the company that
// owns `domain` (resolving domain aliases to the canonical profile first), if
// not already present. Used whenever a new companyRevenueDeals row is
// inserted so the precomputed category list stays in sync without a full
// recompute.
export async function addCompanyRevenueCategory({
  ctx,
  domain,
  category,
}: {
  ctx: MutationCtx;
  domain: string;
  category: "inference" | "gpu_cluster" | "credits_other";
}): Promise<void> {
  const canonicalDomain = await resolveCanonicalDomain({ db: ctx.db, domain });
  const profile = await ctx.db
    .query("companyProfiles")
    .withIndex("by_domain", (q) => q.eq("domain", canonicalDomain))
    .unique();
  if (!profile) return;

  const categories = profile.revenueCategories ?? [];
  if (categories.includes(category)) return;

  await ctx.db.patch(profile._id, {
    revenueCategories: [...categories, category],
  });
}
