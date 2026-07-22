import {
  fetchPylonAccount,
  fetchPylonIssues,
  fetchPylonMessages,
} from "../lib/pylon/api";
import type { PylonAccountInfo } from "../lib/pylon/api";
import type { PylonIssue } from "../lib/embedding/pylon/text";
import {
  hasCompletedMessageScrape,
  loadAccountCache,
  markMessageScrape,
  openPylonSqlite,
  parseArgs,
  upsertRawAccount,
  upsertRawIssue,
  upsertRawMessages,
} from "./pylon-sqlite";

const BACKFILL_WINDOW_DAYS = 1;

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function processIssue({
  db,
  issue,
  accountCache,
}: {
  db: ReturnType<typeof openPylonSqlite>;
  issue: PylonIssue;
  accountCache: Map<string, PylonAccountInfo>;
}): Promise<boolean> {
  upsertRawIssue({ db, issue });

  if (issue.account?.id) {
    if (!accountCache.has(issue.account.id)) {
      const account = await fetchPylonAccount({ id: issue.account.id, cache: accountCache });
      if (account) upsertRawAccount({ db, account, raw: account.raw ?? account });
    }
  }

  if (hasCompletedMessageScrape({ db, issueId: issue.id, issueUpdatedAt: issue.updated_at })) {
    return false;
  }

  const messages = await fetchPylonMessages({ issueId: issue.id });
  upsertRawMessages({ db, issueId: issue.id, messages });
  markMessageScrape({
    db,
    issueId: issue.id,
    issueUpdatedAt: issue.updated_at,
    status: "complete",
    messageCount: messages.length,
  });
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = openPylonSqlite({ path: args.db });
  const startedAt = Date.now();

  const accountCache = loadAccountCache({ db });
  console.log(`[pylon-sqlite] db=${args.db}, cached ${accountCache.size} accounts from sqlite`);

  const to = new Date();
  const from = args.from ? new Date(args.from) : new Date(to.getTime() - args.days * 86400000);
  console.log(`[pylon-sqlite] fetching issues ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);

  const totalWindows = Math.ceil(args.days / BACKFILL_WINDOW_DAYS);
  let totalFetched = 0;
  let processed = 0;
  let skippedMessages = 0;

  let cursor = new Date(from);
  let windowIndex = 0;
  while (cursor < to) {
    const next = new Date(Math.min(cursor.getTime() + BACKFILL_WINDOW_DAYS * 86400000, to.getTime()));
    windowIndex++;
    const windowStartedAt = Date.now();
    const issues = await fetchPylonIssues({ from: cursor.toISOString(), to: next.toISOString() });
    totalFetched += issues.length;
    console.log(`[pylon-sqlite] window ${windowIndex}/${totalWindows}: ${cursor.toISOString().slice(0,10)}→${next.toISOString().slice(0,10)}, processing ${issues.length} issues...`);

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!;
      try {
        const didFetchMessages = await processIssue({ db, issue, accountCache });
        if (didFetchMessages) {
          processed++;
        } else {
          skippedMessages++;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[pylon-sqlite] failed issue ${issue.id}: ${message}`);
        markMessageScrape({
          db,
          issueId: issue.id,
          issueUpdatedAt: issue.updated_at,
          status: "failed",
          messageCount: 0,
          error: message,
        });
      }
      if ((i + 1) % 5 === 0 || i === issues.length - 1) {
        const elapsed = Date.now() - startedAt;
        const rate = windowIndex / (elapsed / 1000);
        const remainingWindows = totalWindows - windowIndex;
        const eta = rate > 0 ? formatDuration((remainingWindows / rate) * 1000) : "?";
        console.log(`[pylon-sqlite] window ${windowIndex}/${totalWindows}: ${i + 1}/${issues.length} (${processed} new, ${skippedMessages} cached) ETA ${eta} (${formatDuration(elapsed)} elapsed)`);
      }
    }

    cursor = next;
  }

  const totalElapsed = Date.now() - startedAt;
  db.close();
  console.log(`[pylon-sqlite] done: ${totalFetched} issues, ${processed} new message batches, ${skippedMessages} cached — ${formatDuration(totalElapsed)}`);
}

await main();
