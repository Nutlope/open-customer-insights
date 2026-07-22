/**
 * Backfills/refreshes companyProfiles.acr from the per-company "currentAcr"
 * figures in the sales-wins Slack export. companyRevenueDeals were imported
 * without ever updating companyProfiles.acr, so most of these companies have
 * a stale or missing ACR.
 *
 * Companies whose currentAcrConfidence is "flagged_review" (the amount likely
 * represents a multi-year contract value, not an annual run-rate), or whose
 * currentAcr is under $100 (likely a placeholder/stale/test deal), are not
 * applied directly - instead an acrSuggestions row is created for admin
 * review at /admin/acr-suggestions.
 *
 * Usage:
 *   bun run scripts/update-company-acr-from-sales-wins.ts --dry-run
 *   bun run scripts/update-company-acr-from-sales-wins.ts
 */
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

const dryRun = process.argv.includes("--dry-run");

type CompanyAcr = {
  company: string;
  companyKey: string;
  currentAcr: number | null;
  currentAcrConfidence: string | null;
  currentAcrAsOf: string | null;
};

type ByCompanyExport = { companies: CompanyAcr[] };

const UPDATE_BATCH_SIZE = 50;

async function main() {
  const byCompany = JSON.parse(
    readFileSync(resolve("data/slack-exports/sales-wins-by-company.json"), "utf-8")
  ) as ByCompanyExport;
  const companyToDomain = JSON.parse(
    readFileSync(resolve("data/slack-exports/sales-wins-company-domains.json"), "utf-8")
  ) as Record<string, string>;

  const NEAR_ZERO_THRESHOLD = 100;

  // Some Slack company names (companyKeys) resolve to the same domain. Pick
  // the one with the most recent currentAcrAsOf as the domain's ACR.
  type DomainAcr = { domain: string; currentAcr: number; currentAcrConfidence: string | null; currentAcrAsOf: string | null };
  const byDomain = new Map<string, DomainAcr>();
  for (const c of byCompany.companies) {
    const domain = companyToDomain[c.companyKey];
    if (!domain || domain.endsWith(".invalid")) continue;
    if (!c.currentAcr || c.currentAcr <= 0) continue;

    const existing = byDomain.get(domain);
    if (!existing || (c.currentAcrAsOf ?? "") > (existing.currentAcrAsOf ?? "")) {
      byDomain.set(domain, { domain, currentAcr: c.currentAcr, currentAcrConfidence: c.currentAcrConfidence, currentAcrAsOf: c.currentAcrAsOf });
    }
  }

  const records: { domain: string; acr: number }[] = [];
  const suggestions: { domain: string; proposedAcr: number; reason: "flagged_review" | "near_zero"; confidence?: string }[] = [];

  for (const c of byDomain.values()) {
    const domain = c.domain;

    if (c.currentAcrConfidence === "flagged_review") {
      suggestions.push({ domain, proposedAcr: c.currentAcr, reason: "flagged_review", confidence: c.currentAcrConfidence ?? undefined });
      continue;
    }

    if (c.currentAcr < NEAR_ZERO_THRESHOLD) {
      suggestions.push({ domain, proposedAcr: c.currentAcr, reason: "near_zero", confidence: c.currentAcrConfidence ?? undefined });
      continue;
    }

    records.push({ domain, acr: c.currentAcr });
  }

  console.log(`${records.length} companies with a usable currentAcr to apply directly.`);
  console.log(`${suggestions.length} companies need admin review (flagged_review / near_zero).`);

  let totalUpdated = 0;
  const notFound = new Set<string>();
  for (let start = 0; start < records.length; start += UPDATE_BATCH_SIZE) {
    const batch = records.slice(start, start + UPDATE_BATCH_SIZE);
    const argsJson = JSON.stringify({ records: batch, dryRun });
    const result = execSync(
      `npx convex run companies:updateCompanyAcrFromSalesWinsInternal '${argsJson.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim()) as {
      updated: number;
      notFound: string[];
      changes: { domain: string; previousAcr: number | null; newAcr: number }[];
    };
    totalUpdated += parsed.updated;
    for (const d of parsed.notFound) notFound.add(d);
    for (const change of parsed.changes) {
      console.log(`  ${change.domain}: ${change.previousAcr ?? "null"} -> ${change.newAcr}`);
    }
  }

  console.log(`\n${dryRun ? "[dry-run] Would update" : "Updated"} ${totalUpdated} companies.`);
  if (notFound.size > 0) {
    console.log(`No matching companyProfiles for: ${[...notFound].join(", ")}`);
  }

  if (dryRun) {
    for (const s of suggestions) console.log(`  [suggest] ${s.domain}: ${s.reason} -> $${s.proposedAcr}`);
    console.log(`[dry-run] Would propose ${suggestions.length} ACR suggestions for admin review.`);
    return;
  }

  let totalProposed = 0;
  for (let start = 0; start < suggestions.length; start += UPDATE_BATCH_SIZE) {
    const batch = suggestions.slice(start, start + UPDATE_BATCH_SIZE);
    const argsJson = JSON.stringify({ suggestions: batch });
    const result = execSync(
      `npx convex run companies:proposeAcrSuggestionsInternal '${argsJson.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim()) as { inserted: number; skipped: number };
    totalProposed += parsed.inserted;
  }

  console.log(`Proposed ${totalProposed} ACR suggestions for admin review.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
