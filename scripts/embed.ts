import { execFileSync } from "child_process";

interface Stats {
  chunksTotal: number;
  chunksEmbedded: number;
}

function convexRun<T>({ functionPath, args = {} }: { functionPath: string; args?: Record<string, never> }): T {
  const output = execFileSync("npx", ["convex", "run", functionPath, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return JSON.parse(output) as T;
}

const initial = convexRun<Stats>({ functionPath: "queries:getStatsInternal" });
const pending = initial.chunksTotal - initial.chunksEmbedded;
console.log(`Starting: ${pending} pending / ${initial.chunksTotal} total chunks\n`);

if (pending === 0) {
  console.log("Nothing to embed.");
  process.exit(0);
}

const startTime = Date.now();
let embeddedSoFar = 0;
let round = 0;

while (true) {
  const count = convexRun<number>({ functionPath: "embed:embedAllPending" });
  if (count === 0) break;

  embeddedSoFar += count;
  round++;

  const elapsed = (Date.now() - startTime) / 1000;
  const rate = embeddedSoFar / elapsed;
  const remaining = pending - embeddedSoFar;
  const etaSec = rate > 0 ? Math.round(remaining / rate) : 0;
  const eta = etaSec > 60
    ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s`
    : `${etaSec}s`;

  const stats = convexRun<Stats>({ functionPath: "queries:getStatsInternal" });
  const pct = stats.chunksTotal > 0
    ? Math.round((stats.chunksEmbedded / stats.chunksTotal) * 100)
    : 0;

  const bar = "#".repeat(Math.floor(pct / 5)) + "-".repeat(20 - Math.floor(pct / 5));
  console.log(`[${bar}] ${pct}% - ${stats.chunksEmbedded}/${stats.chunksTotal} chunks - ${rate.toFixed(1)}/s - ETA ${eta} - round ${round}`);
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nDone - ${embeddedSoFar} chunks embedded in ${elapsed}s`);
