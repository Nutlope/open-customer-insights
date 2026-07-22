/**
 * Cross-references companies in parsed sales-wins data
 * against the companyProfiles table (Salesforce/Clay import) to find wins
 * companies that are missing from the companies database.
 *
 * Usage:
 *   bun run scripts/match-sales-wins-companies.ts [byCompanyFile] [profilesFile]
 *
 * Defaults:
 *   byCompanyFile=data/slack-exports/sales-wins-by-company.json
 *   profilesFile=data/slack-exports/company-profiles.json
 *     (generate with: npx convex run companies:listAllCompaniesInternal '{"limit": 10000}' > data/slack-exports/company-profiles.json)
 *
 * Output:
 *   data/slack-exports/sales-wins-unmatched-companies.csv
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { findUnmatchedWinsCompanies, type CompanyProfile, type WinsCompany } from "../lib/sales-wins/companyMatch";

const byCompanyArg = process.argv[2] ?? "data/slack-exports/sales-wins-by-company.json";
const profilesArg = process.argv[3] ?? "data/slack-exports/company-profiles.json";
const outPath = resolve("data/slack-exports/sales-wins-unmatched-companies.csv");

function csvEscape(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function main() {
  const byCompany = (JSON.parse(readFileSync(resolve(byCompanyArg), "utf-8")) as { companies: WinsCompany[] }).companies;
  const profiles = JSON.parse(readFileSync(resolve(profilesArg), "utf-8")) as CompanyProfile[];

  const { matched, unmatched } = findUnmatchedWinsCompanies({ companies: byCompany, profiles });
  unmatched.sort((a, b) => b.lifetimeAmount - a.lifetimeAmount);

  const lines = ["company,dealCount,lifetimeAmount,currentAcr,currentAcrConfidence"];
  for (const c of unmatched) {
    lines.push([csvEscape(c.company), csvEscape(c.dealCount), csvEscape(c.lifetimeAmount), csvEscape(c.currentAcr), csvEscape(c.currentAcrConfidence)].join(","));
  }
  writeFileSync(outPath, lines.join("\n") + "\n");

  const unmatchedLifetime = unmatched.reduce((sum, c) => sum + c.lifetimeAmount, 0);
  console.log(`Wins companies: ${byCompany.length}`);
  console.log(`Matched in companyProfiles: ${matched}`);
  console.log(`Unmatched: ${unmatched.length} (lifetime amount $${unmatchedLifetime.toLocaleString()})`);
  console.log(`Wrote: ${outPath}`);
}

main();
