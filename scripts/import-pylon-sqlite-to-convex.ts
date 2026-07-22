import { execFileSync } from "child_process";
import { Database } from "bun:sqlite";
import { buildPylonEmbeddingText, type PylonIssue, type PylonMessage } from "../lib/embedding/pylon/text";
import { shouldImportPylonIssue, type PylonImportFilterMode, type PylonImportFilterReason } from "../lib/pylon/importFilter";
import { DEFAULT_PYLON_SQLITE_DB, type AccountRow, type IssueRow, type MessageRow } from "./pylon-sqlite";

interface ImportArgs {
  db: string;
  batchSize: number;
  limit?: number;
  from?: string;
  to?: string;
  dryRun: boolean;
  filterMode: PylonImportFilterMode;
}

interface AccountInfo {
  name?: string;
  domain?: string;
}

interface ImportIssue {
  pylonId: string;
  number: number;
  title: string;
  state: string;
  source: string;
  tags: string[];
  accountId?: string;
  companyName?: string;
  companyDomain?: string;
  issueCategory?: string;
  priority?: string;
  type?: string;
  requesterId?: string;
  requesterEmail?: string;
  assigneeId?: string;
  assigneeEmail?: string;
  teamId?: string;
  link?: string;
  latestMessageTime?: string;
  firstResponseTime?: string;
  resolutionTime?: string;
  customerPortalVisible?: boolean;
  createdAt: string;
  updatedAt: string;
  ingestedAt: string;
}

interface ImportChunk {
  chunkId: string;
  text: string;
  authors: string[];
}

interface ImportItem {
  issue: ImportIssue;
  chunks: ImportChunk[];
}

interface BatchResult {
  importedIssues: number;
  importedChunks: number;
}

const DEFAULT_BATCH_SIZE = 50;
const MAX_ARG_CHARS = 700_000;

function parseArgs(argv: string[]): ImportArgs {
  const args: ImportArgs = {
    db: DEFAULT_PYLON_SQLITE_DB,
    batchSize: DEFAULT_BATCH_SIZE,
    dryRun: false,
    filterMode: "default",
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--db") args.db = argv[++index] ?? args.db;
    else if (arg === "--batch-size") args.batchSize = Number(argv[++index] ?? args.batchSize);
    else if (arg === "--limit") args.limit = Number(argv[++index] ?? 0);
    else if (arg === "--from") args.from = argv[++index];
    else if (arg === "--to") args.to = argv[++index];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--historical-strict") args.filterMode = "historicalStrict";
  }

  if (!Number.isFinite(args.batchSize) || args.batchSize < 1) {
    throw new Error("--batch-size must be a positive number");
  }

  return args;
}

function convexCommand(): { command: string; argsPrefix: string[] } {
  const configured = process.env.CONVEX_BIN;
  if (configured) {
    const [command, ...argsPrefix] = configured.split(" ").filter(Boolean);
    if (!command) throw new Error("CONVEX_BIN is empty");
    return { command, argsPrefix };
  }
  return { command: "npx", argsPrefix: ["convex"] };
}

function runConvexMutation({ functionPath, args }: { functionPath: string; args: unknown }): unknown {
  const { command, argsPrefix } = convexCommand();
  const output = execFileSync(command, [...argsPrefix, "run", functionPath, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const trimmed = output.trim();
  const jsonStart = trimmed.lastIndexOf("{");
  if (jsonStart === -1) return trimmed;
  return JSON.parse(trimmed.slice(jsonStart)) as unknown;
}

function parseRawJson<T>({ rawJson }: { rawJson: string }): T {
  return JSON.parse(rawJson) as T;
}

function getIssueRows({ db, args }: { db: Database; args: ImportArgs }): IssueRow[] {
  const conditions: string[] = [];
  const values: string[] = [];
  if (args.from) {
    conditions.push("created_at >= ?");
    values.push(args.from);
  }
  if (args.to) {
    conditions.push("created_at < ?");
    values.push(args.to);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = args.limit ? `LIMIT ${args.limit}` : "";
  return db.query<IssueRow, string[]>(`
    SELECT pylon_id, number, created_at, updated_at, raw_json
    FROM issues
    ${where}
    ORDER BY created_at ASC
    ${limit}
  `).all(...values);
}

function loadAccounts({ db }: { db: Database }): Map<string, AccountInfo> {
  const rows = db.query<AccountRow, []>("SELECT account_id, name, domain, raw_json FROM accounts").all();
  const accounts = new Map<string, AccountInfo>();
  for (const row of rows) {
    accounts.set(row.account_id, {
      name: row.name ?? undefined,
      domain: row.domain ?? undefined,
    });
  }
  return accounts;
}

function loadMessagesByIssue({ db }: { db: Database }): Map<string, PylonMessage[]> {
  const rows = db.query<MessageRow, []>(
    "SELECT issue_id, message_id, timestamp, is_private, raw_json FROM messages ORDER BY timestamp ASC"
  ).all();
  const messagesByIssue = new Map<string, PylonMessage[]>();
  for (const row of rows) {
    const messages = messagesByIssue.get(row.issue_id) ?? [];
    messages.push(parseRawJson<PylonMessage>({ rawJson: row.raw_json }));
    messagesByIssue.set(row.issue_id, messages);
  }
  return messagesByIssue;
}

function extractDomain({ email }: { email?: string | null }): string | undefined {
  if (!email) return undefined;
  const parts = email.split("@");
  return parts.length === 2 ? parts[1] : undefined;
}

function optionalString({ value }: { value: string | null | undefined }): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function optionalBoolean({ value }: { value: boolean | null | undefined }): boolean | undefined {
  return value ?? undefined;
}

function buildImportIssue({
  issue,
  accountInfo,
  ingestedAt,
}: {
  issue: PylonIssue;
  accountInfo?: AccountInfo;
  ingestedAt: string;
}): ImportIssue {
  return {
    pylonId: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    source: issue.source,
    tags: issue.tags ?? [],
    accountId: optionalString({ value: issue.account?.id }),
    companyName: accountInfo?.name,
    companyDomain: extractDomain({ email: issue.requester?.email }) ?? accountInfo?.domain,
    issueCategory: optionalString({ value: issue.custom_fields?.issue_category?.value }),
    priority: optionalString({ value: issue.custom_fields?.priority?.value }),
    type: optionalString({ value: issue.type }),
    requesterId: optionalString({ value: issue.requester?.id }),
    requesterEmail: optionalString({ value: issue.requester?.email }),
    assigneeId: optionalString({ value: issue.assignee?.id }),
    assigneeEmail: optionalString({ value: issue.assignee?.email }),
    teamId: optionalString({ value: issue.team?.id }),
    link: optionalString({ value: issue.link }),
    latestMessageTime: optionalString({ value: issue.latest_message_time }),
    firstResponseTime: optionalString({ value: issue.first_response_time }),
    resolutionTime: optionalString({ value: issue.resolution_time }),
    customerPortalVisible: optionalBoolean({ value: issue.customer_portal_visible }),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    ingestedAt,
  };
}

function removeUndefined({ item }: { item: ImportIssue }): ImportIssue {
  return JSON.parse(JSON.stringify(item)) as ImportIssue;
}

function itemArgLength({ item }: { item: ImportItem }): number {
  return JSON.stringify({ items: [item] }).length;
}

function flushBatch({
  batch,
  totals,
}: {
  batch: ImportItem[];
  totals: { importedIssues: number; importedChunks: number; batches: number };
}): void {
  if (batch.length === 0) return;
  const result = runConvexMutation({
    functionPath: "mutations:importPylonSqliteBatch",
    args: { items: batch },
  }) as BatchResult;
  totals.importedIssues += result.importedIssues;
  totals.importedChunks += result.importedChunks;
  totals.batches++;
  console.log(`[pylon-sqlite-import] batch ${totals.batches}: +${result.importedIssues} issues, +${result.importedChunks} chunks`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(args.db, { readonly: true });
  const issueRows = getIssueRows({ db, args });
  const accounts = loadAccounts({ db });
  const messagesByIssue = loadMessagesByIssue({ db });
  const ingestedAt = new Date().toISOString();

  const reasonCounts = new Map<PylonImportFilterReason, number>();
  let filtered = 0;
  let noCompany = 0;
  let importable = 0;
  let preparedChunks = 0;
  const totals = { importedIssues: 0, importedChunks: 0, batches: 0 };
  let batch: ImportItem[] = [];
  let batchChars = 0;

  for (const row of issueRows) {
    const issue = parseRawJson<PylonIssue>({ rawJson: row.raw_json });
    const messages = messagesByIssue.get(row.pylon_id) ?? [];
    const decision = shouldImportPylonIssue({ issue, messages, mode: args.filterMode });
    if (!decision.shouldImport) {
      filtered++;
      for (const reason of decision.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      continue;
    }

    const accountInfo = issue.account?.id ? accounts.get(issue.account.id) : undefined;
    const importIssue = removeUndefined({ item: buildImportIssue({ issue, accountInfo, ingestedAt }) });
    if (!importIssue.companyName && !importIssue.companyDomain) {
      noCompany++;
      continue;
    }

    const chunks = buildPylonEmbeddingText(issue, messages, importIssue.companyName, importIssue.companyDomain).map((chunk) => ({
      chunkId: chunk.chunkId,
      text: chunk.text,
      authors: chunk.authors,
    }));
    const item: ImportItem = { issue: importIssue, chunks };
    const itemChars = itemArgLength({ item });

    importable++;
    preparedChunks += chunks.length;
    if (args.dryRun) continue;

    if (batch.length > 0 && (batch.length >= args.batchSize || batchChars + itemChars > MAX_ARG_CHARS)) {
      flushBatch({ batch, totals });
      batch = [];
      batchChars = 0;
    }
    if (itemChars > MAX_ARG_CHARS) {
      console.warn(`[pylon-sqlite-import] large issue ${issue.id} has ${itemChars} JSON chars; sending as a single-item batch`);
    }
    batch.push(item);
    batchChars += itemChars;
  }

  if (!args.dryRun) flushBatch({ batch, totals });

  console.log(JSON.stringify({
    scanned: issueRows.length,
    importable,
    filtered,
    noCompany,
    preparedChunks,
    importedIssues: totals.importedIssues,
    importedChunks: totals.importedChunks,
    batches: totals.batches,
    reasonCounts: [...reasonCounts.entries()].sort((left, right) => right[1] - left[1]),
    dryRun: args.dryRun,
    filterMode: args.filterMode,
  }, null, 2));

  db.close();
}

await main();
