/**
 * Parses an exported sales-wins Slack channel into structured
 * deal records and per-company revenue summaries (by year, lifetime, current ACR).
 *
 * Usage:
 *   bun run scripts/parse-sales-wins.ts [inFile] [outDir]
 *
 * Defaults: inFile=data/slack-exports/sales-wins.json,
 * outDir=data/slack-exports
 *
 * Outputs:
 *   <outDir>/sales-wins-deals.json   - one row per closed-won deal
 *   <outDir>/sales-wins-deals.csv    - same, as CSV
 *   <outDir>/sales-wins-by-company.json - per-company revenue by year, lifetime, current ACR
 *   <outDir>/sales-wins-by-company.csv  - same, as CSV
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { parseClosedWonMessage, type SalesWinDeal } from "../lib/sales-wins/parse";

type ExportMessage = {
  ts: string;
  timestamp?: string;
  text?: string;
  rawText?: string;
  botId?: string;
  replies?: ExportMessage[];
};

type ExportFile = {
  messages: ExportMessage[];
};

type CompanySummary = {
  company: string;
  companyKey: string;
  dealCount: number;
  lifetimeAmount: number;
  amountByYear: Record<number, number>;
  currentAcr: number | null;
  currentAcrAsOf: string | null;
  currentAcrConfidence: string | null;
  currentAcrOpportunity?: string;
};

const inArg = process.argv[2] ?? "data/slack-exports/sales-wins.json";
const outDir = process.argv[3] ?? "data/slack-exports";
const inputPath = resolve(inArg);
const outputDir = resolve(outDir);

function csvEscape(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function writeCsv({ path, rows, columns }: { path: string; rows: Record<string, string | number | null | undefined>[]; columns: string[] }): void {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col])).join(","));
  }
  writeFileSync(path, lines.join("\n") + "\n");
}

function main() {
  const data = JSON.parse(readFileSync(inputPath, "utf-8")) as ExportFile;

  const deals: SalesWinDeal[] = [];
  for (const message of data.messages) {
    const deal = parseClosedWonMessage({ message });
    if (deal) deals.push(deal);
  }
  deals.sort((a, b) => Number(a.ts) - Number(b.ts));

  console.log(`Parsed ${deals.length} closed-won deals.`);

  mkdirSync(outputDir, { recursive: true });

  // ─── deals output ───────────────────────────────────────────────────────
  writeFileSync(resolve(outputDir, "sales-wins-deals.json"), JSON.stringify(deals, null, 2));
  writeCsv({
    path: resolve(outputDir, "sales-wins-deals.csv"),
    rows: deals.map((d) => ({
      date: d.date,
      year: d.year,
      company: d.company,
      opportunity: d.opportunityName,
      opportunityType: d.opportunityType,
      ownerAE: d.ownerAE,
      cx: d.cx.join("; "),
      amount: d.amount,
      acr: d.acr,
      termLengthDays: d.termLengthDays,
      effectiveAcr: d.effectiveAcr,
      acrConfidence: d.acrConfidence,
      businessUseCase: d.businessUseCase,
      maxGpuPrice: d.maxGpuPrice,
      opportunityUrl: d.opportunityUrl,
    })),
    columns: [
      "date", "year", "company", "opportunity", "opportunityType", "ownerAE", "cx",
      "amount", "acr", "termLengthDays", "effectiveAcr", "acrConfidence", "businessUseCase", "maxGpuPrice", "opportunityUrl",
    ],
  });

  // ─── flagged deals (large amount-only, no ACR/term length) ─────────────
  const flagged = deals.filter((d) => d.acrConfidence === "flagged_review");
  writeCsv({
    path: resolve(outputDir, "sales-wins-flagged.csv"),
    rows: flagged.map((d) => ({
      date: d.date,
      company: d.company,
      opportunity: d.opportunityName,
      opportunityType: d.opportunityType,
      amount: d.amount,
      ownerAE: d.ownerAE,
      opportunityUrl: d.opportunityUrl,
    })),
    columns: ["date", "company", "opportunity", "opportunityType", "amount", "ownerAE", "opportunityUrl"],
  });

  // ─── per-company summary ───────────────────────────────────────────────
  const byCompany = new Map<string, CompanySummary>();
  for (const deal of deals) {
    let summary = byCompany.get(deal.companyKey);
    if (!summary) {
      summary = {
        company: deal.company,
        companyKey: deal.companyKey,
        dealCount: 0,
        lifetimeAmount: 0,
        amountByYear: {},
        currentAcr: null,
        currentAcrAsOf: null,
        currentAcrConfidence: null,
      };
      byCompany.set(deal.companyKey, summary);
    }
    // Prefer the most recently-seen display name (deals are in chronological order).
    summary.company = deal.company;
    summary.dealCount += 1;
    summary.lifetimeAmount += deal.amount ?? 0;
    summary.amountByYear[deal.year] = (summary.amountByYear[deal.year] ?? 0) + (deal.amount ?? 0);

    // Latest deal sets the company's current ACR run-rate. A deal with no
    // ACR signal at all (e.g. missing amount) doesn't reset a known run-rate.
    if (deal.effectiveAcr !== null) {
      summary.currentAcr = deal.effectiveAcr;
      summary.currentAcrAsOf = deal.date;
      summary.currentAcrConfidence = deal.acrConfidence;
      summary.currentAcrOpportunity = deal.opportunityName;
    }
  }

  const years = [...new Set(deals.map((d) => d.year))].sort();
  const companies = [...byCompany.values()].sort((a, b) => b.lifetimeAmount - a.lifetimeAmount);

  writeFileSync(resolve(outputDir, "sales-wins-by-company.json"), JSON.stringify({ years, companies }, null, 2));

  writeCsv({
    path: resolve(outputDir, "sales-wins-by-company.csv"),
    rows: companies.map((c) => ({
      company: c.company,
      dealCount: c.dealCount,
      lifetimeAmount: c.lifetimeAmount,
      ...Object.fromEntries(years.map((y) => [`amount${y}`, c.amountByYear[y] ?? 0])),
      currentAcr: c.currentAcr,
      currentAcrAsOf: c.currentAcrAsOf,
      currentAcrConfidence: c.currentAcrConfidence,
    })),
    columns: ["company", "dealCount", "lifetimeAmount", ...years.map((y) => `amount${y}`), "currentAcr", "currentAcrAsOf", "currentAcrConfidence"],
  });

  const totalCurrentAcr = companies.reduce((sum, c) => sum + (c.currentAcr ?? 0), 0);
  const flaggedCompanies = companies.filter((c) => c.currentAcrConfidence === "flagged_review");
  const totalFlagged = flaggedCompanies.reduce((sum, c) => sum + (c.currentAcr ?? 0), 0);

  console.log(`Companies: ${companies.length}`);
  console.log(`Sum of current ACR across all companies: $${totalCurrentAcr.toLocaleString()}`);
  console.log(`  of which ${flagged.length} deals (${flaggedCompanies.length} companies, $${totalFlagged.toLocaleString()}) are FLAGGED for review`);
  console.log(`  -> see sales-wins-flagged.csv`);
  console.log(`\nWrote:`);
  console.log(`  ${resolve(outputDir, "sales-wins-deals.json")}`);
  console.log(`  ${resolve(outputDir, "sales-wins-deals.csv")}`);
  console.log(`  ${resolve(outputDir, "sales-wins-by-company.json")}`);
  console.log(`  ${resolve(outputDir, "sales-wins-by-company.csv")}`);
  console.log(`  ${resolve(outputDir, "sales-wins-flagged.csv")}`);
}

main();
