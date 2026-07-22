import { mkdirSync } from "fs";
import { dirname } from "path";
import { Database } from "bun:sqlite";
import type { PylonIssue, PylonMessage } from "../lib/embedding/pylon/text";
import { shouldImportPylonIssue, type PylonImportFilterDecision } from "../lib/pylon/importFilter";
import type { PylonAccountInfo } from "../lib/pylon/api";

export const DEFAULT_PYLON_SQLITE_DB = "data/pylon-raw.sqlite";

export interface ScriptArgs {
  db: string;
  days: number;
  from?: string;
  windowDays: number;
  limit?: number;
}

export interface IssueRow {
  pylon_id: string;
  number: number;
  created_at: string;
  updated_at: string;
  raw_json: string;
}

export interface MessageRow {
  issue_id: string;
  message_id: string;
  timestamp: string | null;
  is_private: number;
  raw_json: string;
}

export interface AccountRow {
  account_id: string;
  name: string | null;
  domain: string | null;
  raw_json: string;
}

export interface PylonSqliteIssueImportDecision {
  issueRow: IssueRow;
  decision: PylonImportFilterDecision;
}

function parseRawJson<T>({ rawJson }: { rawJson: string }): T {
  return JSON.parse(rawJson) as T;
}

export function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = {
    db: DEFAULT_PYLON_SQLITE_DB,
    days: 365,
    windowDays: 1,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db") args.db = argv[++i] ?? args.db;
    else if (arg === "--days") args.days = Number(argv[++i] ?? args.days);
    else if (arg === "--from") args.from = argv[++i];
    else if (arg === "--window-days") args.windowDays = Number(argv[++i] ?? args.windowDays);
    else if (arg === "--limit") args.limit = Number(argv[++i] ?? 0);
  }

  return args;
}

export function openPylonSqlite({ path }: { path: string }): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS scrape_windows (
      window_start TEXT PRIMARY KEY,
      window_end TEXT NOT NULL,
      status TEXT NOT NULL,
      issue_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issues (
      pylon_id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      scraped_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      name TEXT,
      domain TEXT,
      raw_json TEXT NOT NULL,
      scraped_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      issue_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      timestamp TEXT,
      is_private INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL,
      scraped_at TEXT NOT NULL,
      PRIMARY KEY (issue_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_issue_id ON messages(issue_id);

    CREATE TABLE IF NOT EXISTS issue_message_scrapes (
      issue_id TEXT PRIMARY KEY,
      issue_updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      scraped_at TEXT NOT NULL
    );
  `);
  return db;
}

export function upsertRawIssue({ db, issue }: { db: Database; issue: PylonIssue }): void {
  db.query<unknown, [string, number, string, string, string, string]>(`
    INSERT INTO issues (pylon_id, number, created_at, updated_at, raw_json, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(pylon_id) DO UPDATE SET
      number = excluded.number,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      raw_json = excluded.raw_json,
      scraped_at = excluded.scraped_at
  `).run(issue.id, issue.number, issue.created_at, issue.updated_at, JSON.stringify(issue), new Date().toISOString());
}

export function loadAccountCache({ db }: { db: Database }): Map<string, PylonAccountInfo> {
  const rows = db.query<{ account_id: string; name: string | null; domain: string | null; raw_json: string }, []>(
    "SELECT account_id, name, domain, raw_json FROM accounts"
  ).all();
  const cache = new Map<string, PylonAccountInfo>();
  for (const row of rows) {
    let raw: { name?: string; primary_domain?: string } | undefined;
    try { raw = JSON.parse(row.raw_json); } catch { /* ignore parse errors */ }
    cache.set(row.account_id, {
      id: row.account_id,
      name: row.name ?? undefined,
      domain: row.domain ?? undefined,
      raw,
    });
  }
  return cache;
}

export function upsertRawAccount({
  db,
  account,
  raw,
}: {
  db: Database;
  account: PylonAccountInfo;
  raw: unknown;
}): void {
  db.query<unknown, [string, string | null, string | null, string, string]>(`
    INSERT INTO accounts (account_id, name, domain, raw_json, scraped_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      name = excluded.name,
      domain = excluded.domain,
      raw_json = excluded.raw_json,
      scraped_at = excluded.scraped_at
  `).run(account.id, account.name ?? null, account.domain ?? null, JSON.stringify(raw), new Date().toISOString());
}

export function upsertRawMessages({
  db,
  issueId,
  messages,
}: {
  db: Database;
  issueId: string;
  messages: PylonMessage[];
}): void {
  const stmt = db.query<unknown, [string, string, string | null, number, string, string]>(`
    INSERT INTO messages (issue_id, message_id, timestamp, is_private, raw_json, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(issue_id, message_id) DO UPDATE SET
      timestamp = excluded.timestamp,
      is_private = excluded.is_private,
      raw_json = excluded.raw_json,
      scraped_at = excluded.scraped_at
  `);
  const tx = db.transaction(() => {
    messages.forEach((message, index) => {
      const fallbackId = `${message.timestamp ?? "no-timestamp"}-${index}`;
      stmt.run(
        issueId,
        message.id ?? fallbackId,
        message.timestamp ?? null,
        message.is_private ? 1 : 0,
        JSON.stringify(message),
        new Date().toISOString()
      );
    });
  });
  tx();
}

export function hasCompletedMessageScrape({
  db,
  issueId,
  issueUpdatedAt,
}: {
  db: Database;
  issueId: string;
  issueUpdatedAt: string;
}): boolean {
  const row = db.query<{ status: string }, [string, string]>(
    "SELECT status FROM issue_message_scrapes WHERE issue_id = ? AND issue_updated_at = ?"
  ).get(issueId, issueUpdatedAt);
  return row?.status === "complete";
}

export function markMessageScrape({
  db,
  issueId,
  issueUpdatedAt,
  status,
  messageCount,
  error,
}: {
  db: Database;
  issueId: string;
  issueUpdatedAt: string;
  status: "complete" | "failed";
  messageCount: number;
  error?: string;
}): void {
  db.query<unknown, [string, string, string, number, string | null, string]>(`
    INSERT INTO issue_message_scrapes (issue_id, issue_updated_at, status, message_count, error, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(issue_id) DO UPDATE SET
      issue_updated_at = excluded.issue_updated_at,
      status = excluded.status,
      message_count = excluded.message_count,
      error = excluded.error,
      scraped_at = excluded.scraped_at
  `).run(issueId, issueUpdatedAt, status, messageCount, error ?? null, new Date().toISOString());
}

export function loadPylonSqliteMessagesForIssue({
  db,
  issueId,
}: {
  db: Database;
  issueId: string;
}): PylonMessage[] {
  const rows = db.query<MessageRow, [string]>(
    "SELECT issue_id, message_id, timestamp, is_private, raw_json FROM messages WHERE issue_id = ?"
  ).all(issueId);

  return rows.map((row) => parseRawJson<PylonMessage>({ rawJson: row.raw_json }));
}

export function getPylonSqliteIssueImportDecision({
  db,
  issueRow,
}: {
  db: Database;
  issueRow: IssueRow;
}): PylonSqliteIssueImportDecision {
  const issue = parseRawJson<PylonIssue>({ rawJson: issueRow.raw_json });
  const messages = loadPylonSqliteMessagesForIssue({ db, issueId: issueRow.pylon_id });

  return {
    issueRow,
    decision: shouldImportPylonIssue({ issue, messages }),
  };
}
