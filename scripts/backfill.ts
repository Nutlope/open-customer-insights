/**
 * Backfills Gong calls and/or Pylon issues in 7-day chunks.
 * Never deletes existing data — safe to re-run.
 *
 * Uses `npx convex run` to call internal actions (not exposed publicly).
 *
 * Usage:
 *   bun run scripts/backfill.ts              # both sources, last 90 days
 *   bun run scripts/backfill.ts gong 365     # gong only, last 365 days
 *   bun run scripts/backfill.ts pylon 180    # pylon only, last 180 days
 */
import { execSync } from "child_process";

const CHUNK_DAYS = 7;

const sourceArg = process.argv[2] ?? "both";
const days = Number(process.argv[3] ?? 90);

function convexRun(funcPath: string, args: Record<string, string>): void {
  const argsJson = JSON.stringify(args);
  execSync(`npx convex run ${funcPath} '${argsJson}'`, { stdio: "inherit" });
}

async function backfillSource(source: "gong" | "pylon", totalDays: number) {
  const now = new Date();
  const start = new Date(now.getTime() - totalDays * 24 * 60 * 60 * 1000);

  const chunks: { from: Date; to: Date }[] = [];
  let cursor = new Date(start);
  while (cursor < now) {
    const next = new Date(Math.min(cursor.getTime() + CHUNK_DAYS * 24 * 60 * 60 * 1000, now.getTime()));
    chunks.push({ from: new Date(cursor), to: next });
    cursor = next;
  }

  console.log(`\n[${source}] ${totalDays} days → ${chunks.length} chunks of ${CHUNK_DAYS} days`);

  const funcPath = source === "gong"
    ? "ingest:importGongRange"
    : "ingest:importPylonRange";

  for (let i = 0; i < chunks.length; i++) {
    const { from, to } = chunks[i]!;
    console.log(`  [${i + 1}/${chunks.length}] ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);
    try {
      convexRun(funcPath, { from: from.toISOString(), to: to.toISOString() });
      console.log(`    ✅ done`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`    ❌ failed: ${message}`);
    }
  }
}

async function main() {
  if (sourceArg !== "gong" && sourceArg !== "pylon" && sourceArg !== "both") {
    console.error("Usage: bun run scripts/backfill.ts [gong|pylon|both] [days]");
    process.exit(1);
  }

  if (sourceArg === "gong" || sourceArg === "both") await backfillSource("gong", days);
  if (sourceArg === "pylon" || sourceArg === "both") await backfillSource("pylon", days);

  console.log("\n✅ Backfill complete! Run embed separately when ready.");
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});