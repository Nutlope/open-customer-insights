/**
 * Backfill script: drops and regenerates daily reports for the past N weeks.
 *
 * Usage:
 *   bun run scripts/backfill-daily-insights.ts        # last 3 weeks (default)
 *   bun run scripts/backfill-daily-insights.ts 2      # last 2 weeks
 *   bun run scripts/backfill-daily-insights.ts 3 --dry-run  # preview without changing anything
 */
import { execFileSync } from "child_process";

const WEEKS = parseInt(process.argv[2] || "3", 10);
const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = 12_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function sleep({ ms }: { ms: number }) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate({ date }: { date: Date }): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays({ date, days }: { date: Date; days: number }): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function convexRun<T>({ functionPath, args }: { functionPath: string; args: Record<string, unknown> }): T {
  const output = execFileSync("npx", ["convex", "run", functionPath, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return JSON.parse(output) as T;
}

async function main() {
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const yesterday = addUtcDays({ date: utcToday, days: -1 });
  const rangeStart = addUtcDays({ date: utcToday, days: -(WEEKS * 7) });

  const from = toIsoDate({ date: rangeStart });
  const to = toIsoDate({ date: yesterday });

  console.log(`Backfilling daily insights from ${from} to ${to} (${WEEKS} weeks, ${DRY_RUN ? "DRY RUN" : "LIVE"})`);

  // Step 1: delete existing daily reports in range
  if (DRY_RUN) {
    console.log(`\n[dry-run] Would delete daily reports from ${from} to ${to}`);
  } else {
    process.stdout.write(`\nDeleting existing daily reports [${from} → ${to}] ... `);
    const deleted = convexRun<{ reportsDeleted: number; insightsDeleted: number }>({
      functionPath: "reportsQueries:deleteReportsByTypeRange",
      args: { type: "daily", from, to },
    });
    console.log(`deleted ${deleted.reportsDeleted} reports, ${deleted.insightsDeleted} insights`);
  }

  // Step 2: regenerate one report per day
  let generated = 0;
  let skipped = 0;
  let errors = 0;

  console.log("\nGenerating daily reports...");
  for (let d = rangeStart; d <= yesterday; d = addUtcDays({ date: d, days: 1 })) {
    const periodStart = toIsoDate({ date: d });
    const periodEnd = toIsoDate({ date: addUtcDays({ date: d, days: 1 }) });

    process.stdout.write(`  daily ${periodStart} → ${periodEnd} ... `);

    if (DRY_RUN) {
      console.log("(dry-run)");
      continue;
    }

    try {
      const result = convexRun<unknown>({
        functionPath: "reports:doGenerateForRange",
        args: { type: "daily", periodStart, periodEnd, force: true },
      });
      if (typeof result === "object" && result !== null && "summary" in result) {
        console.log("OK");
        generated++;
      } else {
        console.log("SKIP (no data)");
        skipped++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAIL: ${msg.slice(0, 120)}`);
      errors++;
    }

    await sleep({ ms: DELAY_MS });
  }

  console.log(`\nDone. Generated: ${generated}, Skipped: ${skipped}, Errors: ${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
