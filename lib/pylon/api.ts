import { buildPylonEmbeddingText, type PylonIssue, type PylonMessage } from "../embedding/pylon/text";
import { shouldImportPylonIssue } from "./importFilter";
import { extractDomain, type SharedStoreDb } from "../utils";

const PYLON_API_BASE = "https://api.usepylon.com";
export const PYLON_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

type PylonEndpointLabel = "issues" | "messages" | "account";

const PYLON_ENDPOINT_MIN_DELAY_MS: Record<PylonEndpointLabel, number> = {
  issues: 6000,  // GET /issues — 10 req/min (docs.usepylon.com)
  messages: 3000, // GET /issues/{id}/messages — 20 req/min
  account: 6000,  // GET /accounts/{id} — inferred ~10 req/min
};

const lastRequestAt = new Map<PylonEndpointLabel, number>();
let lastPylonRequestAt = 0;
const PYLON_GLOBAL_MIN_DELAY_MS = 2000;

function pylonHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.PYLON_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export interface PylonAccountInfo {
  id: string;
  name?: string;
  domain?: string;
  raw?: unknown;
}

async function waitFromRateLimitHeaders({ res, label }: { res: Response; label: PylonEndpointLabel }): Promise<void> {
  const remaining = Number(res.headers.get("x-rate-limit-remaining") ?? "");
  if (!isNaN(remaining) && remaining <= 1) {
    const resetAt = Number(res.headers.get("x-rate-limit-reset") ?? "") * 1000;
    let waitMs: number;
    if (resetAt && resetAt > Date.now()) {
      waitMs = resetAt - Date.now() + 500;
    } else {
      waitMs = 8000;
    }
    console.log(`[pylon:${label}] rate limit nearly exhausted (remaining=${remaining}), waiting ${Math.round(waitMs / 1000)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

async function fetchWithRetry({
  url,
  label,
  rateLimit,
}: {
  url: string;
  label: PylonEndpointLabel;
  rateLimit?: () => Promise<void>;
}): Promise<Response | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = Date.now();
    const lastEndpointAt = lastRequestAt.get(label) ?? 0;
    const endpointWaitMs = Math.max(PYLON_ENDPOINT_MIN_DELAY_MS[label] - (now - lastEndpointAt), 0);
    const globalWaitMs = Math.max(PYLON_GLOBAL_MIN_DELAY_MS - (now - lastPylonRequestAt), 0);
    const waitMs = Math.max(endpointWaitMs, globalWaitMs);
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    if (rateLimit) await rateLimit();
    const res = await fetch(url, { headers: pylonHeaders() });
    const completedAt = Date.now();
    lastRequestAt.set(label, completedAt);
    lastPylonRequestAt = completedAt;
    if (res.ok) {
      await waitFromRateLimitHeaders({ res, label });
      return res;
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 6) * 1000;
      console.warn(`[pylon] 429 on ${url}, retrying after ${retryAfter}ms`);
      await new Promise((r) => setTimeout(r, retryAfter));
      continue;
    }
    console.warn(`[pylon] ${url} failed: ${res.status}`);
    return null;
  }
  console.warn(`[pylon] gave up after retries: ${url}`);
  return null;
}

export async function fetchPylonAccount({
  id,
  cache,
  rateLimit,
}: {
  id: string;
  cache: Map<string, PylonAccountInfo>;
  rateLimit?: () => Promise<void>;
}): Promise<PylonAccountInfo | undefined> {
  if (cache.has(id)) return cache.get(id);
  const res = await fetchWithRetry({ url: `${PYLON_API_BASE}/accounts/${id}`, label: "account", rateLimit });
  if (!res) return undefined;
  const data = await res.json() as { data: { id: string; name?: string; primary_domain?: string } };
  const a = data.data;
  if (!a) return undefined;
  const info: PylonAccountInfo = { id: a.id, name: a.name, domain: a.primary_domain ?? undefined, raw: a };
  cache.set(id, info);
  return info;
}

const MAX_PAGES = 200;

export async function fetchPylonIssues({
  from,
  to,
  rateLimit,
}: {
  from: string;
  to: string;
  rateLimit?: () => Promise<void>;
}): Promise<PylonIssue[]> {
  const issues: PylonIssue[] = [];
  let cursor: string | undefined;
  let page = 0;
  const seenCursors = new Set<string>();
  do {
    if (page >= MAX_PAGES) {
      console.warn(`[pylon] fetchIssues hit max pages (${MAX_PAGES}), stopping pagination`);
      break;
    }
    if (cursor) {
      if (seenCursors.has(cursor)) {
        console.warn(`[pylon] fetchIssues detected duplicate cursor, breaking to avoid infinite loop`);
        break;
      }
      seenCursors.add(cursor);
    }
    const params = new URLSearchParams({ start_time: from, end_time: to });
    if (cursor) params.set("cursor", cursor);
    const res = await fetchWithRetry({ url: `${PYLON_API_BASE}/issues?${params}`, label: "issues", rateLimit });
    if (!res) throw new Error(`Pylon fetchIssues failed after retries`);
    const data = await res.json() as {
      data?: PylonIssue[];
      next_cursor?: string;
      pagination?: { cursor?: string; has_next_page?: boolean };
    };
    const batch = data.data ?? [];
    issues.push(...batch);
    page++;
    if (batch.length > 0) {
      const dates = batch.map((i) => i.created_at).sort();
      console.log(`[pylon] fetchIssues page ${page}: ${from.slice(0,10)}→${to.slice(0,10)}, got ${batch.length} issues, actual range: ${dates[0]?.slice(0,10)}→${dates[dates.length-1]?.slice(0,10)}`);
    } else {
      console.log(`[pylon] fetchIssues page ${page}: no issues returned`);
    }
    cursor = data.pagination?.has_next_page ? data.pagination.cursor : data.next_cursor;
  } while (cursor);
  console.log(`[pylon] fetchIssues done: ${issues.length} total issues across ${page} pages for ${from.slice(0,10)}→${to.slice(0,10)}`);
  return issues;
}

export async function fetchPylonMessages({
  issueId,
  rateLimit,
}: {
  issueId: string;
  rateLimit?: () => Promise<void>;
}): Promise<PylonMessage[]> {
  const messages: PylonMessage[] = [];
  let cursor: string | undefined;
  let page = 0;
  const seenCursors = new Set<string>();
  do {
    if (cursor) {
      if (seenCursors.has(cursor)) {
        console.warn(`[pylon] fetchMessages detected duplicate cursor for ${issueId}, breaking`);
        break;
      }
      seenCursors.add(cursor);
    }
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    const suffix = params.size ? `?${params}` : "";
    const res = await fetchWithRetry({ url: `${PYLON_API_BASE}/issues/${issueId}/messages${suffix}`, label: "messages", rateLimit });
    if (!res) return messages;
    const data = await res.json() as {
      data?: PylonMessage[];
      pagination?: { cursor?: string; has_next_page?: boolean };
    };
    messages.push(...(data.data ?? []));
    page++;
    cursor = data.pagination?.has_next_page ? data.pagination.cursor : undefined;
  } while (cursor);
  if (page > 1) console.log(`[pylon] fetched ${messages.length} messages across ${page} pages for ${issueId}`);
  return messages;
}

export interface PylonStoreDb extends SharedStoreDb {
  insertPylonIssue(args: PylonInsertIssueArgs): Promise<unknown>;
}

interface PylonInsertIssueArgs {
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

const INTER_CALL_MS = 1200;

function optionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function optionalBoolean(value: boolean | null | undefined): boolean | undefined {
  return value ?? undefined;
}

export async function storePylonIssueTexts({
  issues,
  db,
  ingestedAt,
  rateLimit,
  existingPylonIds,
}: {
  issues: PylonIssue[];
  db: PylonStoreDb;
  ingestedAt: string;
  rateLimit?: () => Promise<void>;
  existingPylonIds?: Set<string>;
}): Promise<{ processed: number; skippedExisting: number; skippedNoCompany: number; skippedFiltered: number }> {
  const accountCache = new Map<string, PylonAccountInfo>();
  let processed = 0;
  let skippedExisting = 0;
  let skippedNoCompany = 0;
  let skippedFiltered = 0;
  for (let idx = 0; idx < issues.length; idx++) {
    const issue = issues[idx];

    if (existingPylonIds?.has(issue.id)) {
      skippedExisting++;
      continue;
    }

    const preFetchFilter = shouldImportPylonIssue({ issue });
    if (!preFetchFilter.shouldImport) {
      console.log(`[pylon] skipping issue ${issue.id} — filtered: ${preFetchFilter.reasons.join(", ")}`);
      skippedFiltered++;
      continue;
    }

    const accountInfo = issue.account?.id
      ? await fetchPylonAccount({ id: issue.account.id, cache: accountCache, rateLimit })
      : undefined;
    const companyName = accountInfo?.name ?? undefined;
    const companyDomain = extractDomain(optionalString(issue.requester?.email)) ?? accountInfo?.domain ?? undefined;
    if (!companyName && !companyDomain) {
      console.log(`[pylon] skipping issue ${issue.id} — no company info`);
      skippedNoCompany++;
      continue;
    }

    if (idx > 0) await new Promise((r) => setTimeout(r, INTER_CALL_MS));
    const messages = await fetchPylonMessages({ issueId: issue.id, rateLimit });

    const postFetchFilter = shouldImportPylonIssue({ issue, messages });
    if (!postFetchFilter.shouldImport) {
      console.log(`[pylon] skipping issue ${issue.id} — filtered: ${postFetchFilter.reasons.join(", ")}`);
      skippedFiltered++;
      continue;
    }

    await db.insertPylonIssue({
      pylonId: issue.id,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      source: issue.source,
      tags: issue.tags ?? [],
      accountId: optionalString(issue.account?.id),
      companyName,
      companyDomain,
      issueCategory: optionalString(issue.custom_fields?.issue_category?.value),
      priority: optionalString(issue.custom_fields?.priority?.value),
      type: optionalString(issue.type),
      requesterId: optionalString(issue.requester?.id),
      requesterEmail: optionalString(issue.requester?.email),
      assigneeId: optionalString(issue.assignee?.id),
      assigneeEmail: optionalString(issue.assignee?.email),
      teamId: optionalString(issue.team?.id),
      link: optionalString(issue.link),
      latestMessageTime: optionalString(issue.latest_message_time),
      firstResponseTime: optionalString(issue.first_response_time),
      resolutionTime: optionalString(issue.resolution_time),
      customerPortalVisible: optionalBoolean(issue.customer_portal_visible),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      ingestedAt,
    });

    const chunks = buildPylonEmbeddingText(issue, messages, companyName, companyDomain);

    for (const chunk of chunks) {
      await db.upsertChunkText({
        dataSource: "pylon",
        sourceId: issue.id,
        chunkId: chunk.chunkId,
        text: chunk.text,
        companyDomain,
        ingestedAt,
        authors: chunk.authors,
      });
    }

    processed++;
    await db.deleteOtherChunks({ dataSource: "pylon", sourceId: issue.id, currentIngestedAt: ingestedAt });
  }
  console.log(`[pylon] storePylonIssueTexts: ${issues.length} fetched, ${skippedExisting} already in DB, ${skippedFiltered} filtered, ${skippedNoCompany} no company, ${processed} processed`);
  return { processed, skippedExisting, skippedNoCompany, skippedFiltered };
}
