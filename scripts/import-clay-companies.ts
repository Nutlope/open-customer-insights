/**
 * Import Clay companies into Convex companyProfiles.
 *
 * Reads data/clay-companies.csv, filters to Potential Customer=true OR ACR>0,
 * resolves missing domains via Exa+LLM, then batch-upserts into Convex.
 *
 * Usage:
 *   bun run scripts/import-clay-companies.ts
 *   bun run scripts/import-clay-companies.ts --dry-run   # parse + resolve only, no Convex writes
 *   bun run scripts/import-clay-companies.ts --no-resolve # skip domain resolution for missing domains
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolveCompanyDomain } from "../lib/domain/resolveCompanyDomain";

const CSV_PATH = "data/clay-companies.csv";
const BATCH_SIZE = 200;

const dryRun = process.argv.includes("--dry-run");
const noResolve = process.argv.includes("--no-resolve");

function parseCsv(raw: string): Record<string, string>[] {
  const lines = raw.split("\n");
  const headers = parseCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function extractDomain(url: string): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(
      url.startsWith("http") ? url : `https://${url}`
    ).hostname;
    return hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

function looksLikeValidDomain(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
    s.replace(/^www\./, "")
  );
}

type CompanyRecord = {
  domain: string;
  name: string;
  status: "customer" | "prospect";
  website?: string;
  salesforceId?: string;
  acr?: number;
  isPotentialCustomer?: boolean;
};

async function main() {
  console.log(`Reading ${CSV_PATH}...`);
  const raw = readFileSync(CSV_PATH, "utf-8");
  const rows = parseCsv(raw);
  console.log(`  ${rows.length} total rows`);

  // Filter to relevant companies
  const relevant = rows.filter((row) => {
    const isPotential = row["Potential Customer"]?.trim().toLowerCase() === "true";
    const acr = parseFloat(row["ACR"] ?? "");
    return isPotential || (acr > 0);
  });
  console.log(`  ${relevant.length} rows after filtering (Potential Customer=true OR ACR>0)`);

  // Resolve domains
  let withDomain = 0;
  let missingDomain = 0;
  let resolvedDomain = 0;
  let skippedNoDomain = 0;

  const companies: CompanyRecord[] = [];

  for (const row of relevant) {
    const name = row["Name"]?.trim() ?? "";
    const salesforceId = row["id"]?.trim() || undefined;
    const websiteRaw = row["Website"]?.trim() || undefined;
    const domainRaw = row["Domain Name"]?.trim() || undefined;
    const acrRaw = parseFloat(row["ACR"] ?? "");
    const acr = isNaN(acrRaw) ? undefined : acrRaw > 0 ? acrRaw : undefined;
    const isPotentialCustomer =
      row["Potential Customer"]?.trim().toLowerCase() === "true" || undefined;

    const status: "customer" | "prospect" = acr && acr > 0 ? "customer" : "prospect";

    // Resolve domain: prefer Domain Name, fall back to Website
    let domain: string | null = null;
    if (domainRaw && looksLikeValidDomain(domainRaw)) {
      domain = domainRaw.replace(/^www\./, "").toLowerCase();
    } else if (websiteRaw) {
      domain = extractDomain(websiteRaw);
    }

    if (domain) {
      withDomain++;
      companies.push({
        domain,
        name,
        status,
        website: websiteRaw,
        salesforceId,
        acr,
        isPotentialCustomer,
      });
    } else {
      missingDomain++;
      if (noResolve || !name) {
        skippedNoDomain++;
        continue;
      }
      // Attempt Exa+LLM resolution
      try {
        const resolved = await resolveCompanyDomain({
          name,
          websiteHint: websiteRaw,
        });
        if (resolved) {
          resolvedDomain++;
          companies.push({
            domain: resolved,
            name,
            status,
            website: websiteRaw,
            salesforceId,
            acr,
            isPotentialCustomer,
          });
        } else {
          skippedNoDomain++;
        }
      } catch (err) {
        console.error(`  [resolve error] "${name}": ${err}`);
        skippedNoDomain++;
      }
    }
  }

  console.log(`\nDomain resolution:`);
  console.log(`  ${withDomain} had domain in CSV`);
  console.log(`  ${missingDomain} missing domain`);
  console.log(`  ${resolvedDomain} resolved via Exa+LLM`);
  console.log(`  ${skippedNoDomain} skipped (no domain found)`);
  console.log(`  ${companies.length} companies ready to import`);

  if (dryRun) {
    console.log("\n[dry-run] Skipping Convex writes.");
    const customers = companies.filter((c) => c.status === "customer").length;
    const prospects = companies.filter((c) => c.status === "prospect").length;
    console.log(`  ${customers} customers, ${prospects} prospects`);
    console.log("\nSample (first 5):");
    for (const c of companies.slice(0, 5)) {
      console.log(`  ${c.name} | ${c.domain} | ${c.status} | ACR: ${c.acr ?? "-"}`);
    }
    return;
  }

  // Batch upsert via npx convex run
  console.log(`\nUpserting in batches of ${BATCH_SIZE}...`);
  let totalInserted = 0;
  let totalUpdated = 0;

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);
    const argsJson = JSON.stringify({ companies: batch });
    const result = execSync(
      `npx convex run companies:upsertCompanies '${argsJson.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(result.trim()) as { inserted: number; updated: number };
    totalInserted += parsed.inserted;
    totalUpdated += parsed.updated;
    process.stdout.write(
      `\r  batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(companies.length / BATCH_SIZE)} — ${totalInserted} inserted, ${totalUpdated} updated`
    );
  }

  console.log(`\n\nDone! ${totalInserted} inserted, ${totalUpdated} updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
