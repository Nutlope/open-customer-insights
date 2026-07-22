/**
 * Imports per-deal revenue records from an exported sales-wins Slack
 * export into companyRevenueDeals, categorizing each deal (inference / GPU
 * cluster / credits & other) and labeling it via Together AI.
 *
 * Usage:
 *   bun run scripts/import-sales-wins-revenue.ts
 *   bun run scripts/import-sales-wins-revenue.ts --dry-run
 *   bun run scripts/import-sales-wins-revenue.ts --limit 10
 *
 * Defaults:
 *   dealsFile=data/slack-exports/sales-wins-deals.json
 *   domainsFile=data/slack-exports/sales-wins-company-domains.json
 *     (company -> domain map; companies not present here are skipped)
 */
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";
import { categorizeDeals, type DealForCategorization } from "../lib/sales-wins/categorizeDeals";
import type { SalesWinDeal } from "../lib/sales-wins/parse";

const rawArgs = process.argv.slice(2);
let dryRun = false;
let limit: number | undefined;
const positional: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i]!;
  if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg === "--limit") {
    limit = Number(rawArgs[++i]);
  } else if (arg.startsWith("--limit=")) {
    limit = Number(arg.split("=")[1]);
  } else {
    positional.push(arg);
  }
}

const dealsArg = positional[0] ?? "data/slack-exports/sales-wins-deals.json";
const domainsArg = positional[1] ?? "data/slack-exports/sales-wins-company-domains.json";

const INSERT_BATCH_SIZE = 50;

function monthOf({ date }: { date: string }): string {
  return date.slice(0, 7);
}

async function main() {
  const deals = JSON.parse(readFileSync(resolve(dealsArg), "utf-8")) as SalesWinDeal[];
  const companyToDomain = JSON.parse(readFileSync(resolve(domainsArg), "utf-8")) as Record<string, string>;

  const resolvable = deals.filter((d) => companyToDomain[d.companyKey]);
  const skippedCompanies = new Set(deals.filter((d) => !companyToDomain[d.companyKey]).map((d) => d.company));
  console.log(`${deals.length} deals total, ${resolvable.length} resolvable to a domain.`);
  if (skippedCompanies.size > 0) {
    console.log(`Skipping companies with no domain mapping: ${[...skippedCompanies].join(", ")}`);
  }

  const toProcess = limit ? resolvable.slice(0, limit) : resolvable;
  console.log(`Categorizing ${toProcess.length} deals via Together AI...`);

  const categorizationInputs: DealForCategorization[] = toProcess.map((d) => ({
    opportunityName: d.opportunityName ?? "(untitled)",
    opportunityType: (d.opportunityType ?? "Net New") as DealForCategorization["opportunityType"],
    amount: d.amount,
    businessUseCase: d.businessUseCase,
  }));

  const categorizations = await categorizeDeals({ deals: categorizationInputs });

  const records = toProcess.map((d, i) => {
    const categorization = categorizations[i]!;
    return {
      domain: companyToDomain[d.companyKey]!,
      date: d.date,
      month: monthOf({ date: d.date }),
      year: d.year,
      amount: d.amount ?? 0,
      opportunityName: d.opportunityName ?? "(untitled)",
      opportunityType: (d.opportunityType ?? "Net New") as "Net New" | "Expansion" | "Renewal",
      category: categorization.category,
      label: categorization.label,
      acrConfidence: d.acrConfidence ?? undefined,
    };
  });

  const byCategory = { inference: 0, gpu_cluster: 0, credits_other: 0 };
  for (const r of records) byCategory[r.category]++;
  console.log(`Categories: inference=${byCategory.inference}, gpu_cluster=${byCategory.gpu_cluster}, credits_other=${byCategory.credits_other}`);

  if (dryRun) {
    console.log("\n[dry-run] Sample records:");
    for (const r of records.slice(0, 10)) {
      console.log(`  ${r.domain} | ${r.month} | $${r.amount.toLocaleString()} | ${r.category} | ${r.label} | "${r.opportunityName}"`);
    }
    console.log(`\n[dry-run] Skipping Convex write (${records.length} records).`);
    return;
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  for (let start = 0; start < records.length; start += INSERT_BATCH_SIZE) {
    const batch = records.slice(start, start + INSERT_BATCH_SIZE);
    const argsJson = JSON.stringify({ deals: batch });
    const result = execSync(
      `npx convex run revenue:insertCompanyRevenueDealsInternal '${argsJson.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim()) as { inserted: number; skipped: number };
    totalInserted += parsed.inserted;
    totalSkipped += parsed.skipped;
    console.log(`  [${start + batch.length}/${records.length}] inserted=${parsed.inserted} skipped=${parsed.skipped}`);
  }

  console.log(`\nDone. Inserted ${totalInserted}, skipped ${totalSkipped} (already present).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
