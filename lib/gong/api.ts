import { buildGongEmbeddingText } from "../embedding/gong/text";
import { extractDomain, type SharedStoreDb } from "../utils";

const GONG_API_BASE = "https://api.gong.io";
const EXTENSIVE_BATCH = 100;
const TRANSCRIPT_BATCH = 100;

const EXTENSIVE_CONTENT_SELECTOR = {
  exposedFields: {
    parties: true,
    content: { brief: true, keyPoints: true, topics: true },
  },
};

function gongAuthHeader(): string {
  return `Basic ${btoa(`${process.env.GONG_ACCESS_KEY}:${process.env.GONG_ACCESS_KEY_SECRET}`)}`;
}

// ── Gong API response types ──────────────────────────────────────────────────

interface GongCallListItem {
  id: string;
  scope: string;
}

interface GongParty {
  speakerId?: string;
  name?: string;
  emailAddress?: string;
  affiliation?: string;
}

interface GongContent {
  brief?: string;
  keyPoints?: { text: string }[];
  topics?: { name: string; duration: number }[];
}

interface GongCallExtensive {
  metaData: {
    id: string;
    title: string;
    started: string;
    duration: number;
    scope?: string;
    system?: string;
  };
  parties?: GongParty[];
  content?: GongContent;
}

interface GongTranscriptSentence {
  text: string;
  start: number;
  end: number;
}

interface GongTranscriptEntry {
  speakerId: string;
  sentences: GongTranscriptSentence[];
}

interface GongTranscript {
  callId: string;
  transcript: GongTranscriptEntry[];
}

interface GongInsertCallArgs {
  gongId: string;
  title: string;
  started: string;
  duration: number;
  parties: { name: string; emailAddress?: string }[];
  companyDomain?: string;
  brief?: string;
  keyPoints?: string[];
  topics?: { name: string; duration: number }[];
  ingestedAt: string;
}

export interface GongStoreDb extends SharedStoreDb {
  insertCall(args: GongInsertCallArgs): Promise<unknown>;
}

// ── API functions ─────────────────────────────────────────────────────────────

// Speaker affiliation as returned by the Gong API. The API uses "Internal" /
// "External" and may omit the field or return something unexpected; both cases
// normalize to "Unknown" so downstream bucketing never treats a mystery party
// as a Together employee.
export type GongAffiliation = "Internal" | "External" | "Unknown";

// Per-speaker info resolved for a single call (speakerId is call-scoped and
// NOT stable across calls — never build a cross-call speaker-ID allowlist).
export interface GongSpeakerInfo {
  name: string;
  affiliation: GongAffiliation;
}

function normalizeAffiliation(value: string | undefined): GongAffiliation {
  if (value === "Internal" || value === "External") return value;
  return "Unknown";
}

export async function fetchExternalCallIds(
  from: string,
  to: string,
  rateLimit?: () => Promise<void>,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    if (rateLimit) await rateLimit();
    const url = new URL(`${GONG_API_BASE}/v2/calls`);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    } else {
      url.searchParams.set("fromDateTime", from);
      url.searchParams.set("toDateTime", to);
    }
    const res = await fetch(url.toString(), { headers: { Authorization: gongAuthHeader() } });
    if (!res.ok) {
      if (res.status === 404) return ids;
      const body = await res.text().catch(() => "(unreadable)");
      throw new Error(`Gong fetchExternalCallIds failed: ${res.status} — ${body}`);
    }
    const data = await res.json() as { calls?: GongCallListItem[]; records?: { cursor?: string } };
    for (const c of data.calls ?? []) {
      if (c.scope === "External") ids.push(c.id);
    }
    cursor = data.records?.cursor;
  } while (cursor);
  return ids;
}

export async function fetchCallsExtensive(
  callIds: string[],
  rateLimit?: () => Promise<void>,
): Promise<GongCallExtensive[]> {
  const calls: GongCallExtensive[] = [];
  for (let i = 0; i < callIds.length; i += EXTENSIVE_BATCH) {
    if (rateLimit) await rateLimit();
    const batch = callIds.slice(i, i + EXTENSIVE_BATCH);
    const res = await fetch(`${GONG_API_BASE}/v2/calls/extensive`, {
      method: "POST",
      headers: { Authorization: gongAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ filter: { callIds: batch }, contentSelector: EXTENSIVE_CONTENT_SELECTOR }),
    });
    if (!res.ok) throw new Error(`Gong fetchCallsExtensive failed: ${res.status}`);
    const data = await res.json() as { calls?: GongCallExtensive[] };
    calls.push(...(data.calls ?? []));
  }
  return calls;
}

export async function fetchTranscripts(
  callIds: string[],
  rateLimit?: () => Promise<void>,
): Promise<GongTranscript[]> {
  const results: GongTranscript[] = [];
  for (let i = 0; i < callIds.length; i += TRANSCRIPT_BATCH) {
    if (rateLimit) await rateLimit();
    const batch = callIds.slice(i, i + TRANSCRIPT_BATCH);
    const res = await fetch(`${GONG_API_BASE}/v2/calls/transcript`, {
      method: "POST",
      headers: { Authorization: gongAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ filter: { callIds: batch } }),
    });
    if (!res.ok) throw new Error(`Gong fetchTranscripts failed: ${res.status}`);
    const data = await res.json() as { callTranscripts?: GongTranscript[] };
    results.push(...(data.callTranscripts ?? []));
  }
  return results;
}

function buildSpeakerMapFromParties(parties: GongParty[]): Map<string, GongSpeakerInfo> {
  const map = new Map<string, GongSpeakerInfo>();
  for (const p of parties) {
    if (!p.speakerId || !p.name) continue;
    map.set(p.speakerId, { name: p.name, affiliation: normalizeAffiliation(p.affiliation) });
  }
  return map;
}

function extractCompanyDomain(parties: GongParty[]): string | undefined {
  const external = parties.find((p) => p.affiliation === "External" && p.emailAddress);
  if (!external) return undefined;
  return extractDomain(external.emailAddress);
}

export async function storeGongCallTexts(
  calls: GongCallExtensive[],
  transcriptMap: Map<string, GongTranscriptEntry[]>,
  db: GongStoreDb,
  ingestedAt: string,
): Promise<void> {
  for (const call of calls) {
    const meta = call.metaData;
    const parties: GongParty[] = call.parties ?? [];
    const content = call.content ?? {};

    const transcript = transcriptMap.get(meta.id) ?? [];
    if (!transcript.length) {
      console.log(`[gong] skipping "${meta.title}" — no transcript`);
      continue;
    }

    const companyDomain = extractCompanyDomain(parties);
    const externalParties = parties
      .filter((p) => p.affiliation === "External" && p.name)
      .map((p) => ({ name: p.name!, emailAddress: p.emailAddress }));
    const keyPoints = (content.keyPoints ?? []).map((kp) => kp.text).filter(Boolean);
    const topics = (content.topics ?? [])
      .filter((t) => t.duration > 0)
      .map((t) => ({ name: t.name, duration: t.duration }));

    await db.insertCall({
      gongId: meta.id,
      title: meta.title,
      started: meta.started,
      duration: meta.duration,
      parties: externalParties,
      companyDomain,
      brief: content.brief ?? undefined,
      keyPoints: keyPoints.length ? keyPoints : undefined,
      topics: topics.length ? topics : undefined,
      ingestedAt,
    });

    const speakerMap = buildSpeakerMapFromParties(parties);
    const normalizedCall = { id: meta.id, title: meta.title, started: meta.started, duration: meta.duration, scope: meta.scope, system: meta.system };
    const chunks = buildGongEmbeddingText(normalizedCall, transcript, speakerMap, content.brief, keyPoints, topics, companyDomain);

    for (const chunk of chunks) {
      await db.upsertChunkText({
        dataSource: "gong",
        sourceId: meta.id,
        chunkId: chunk.chunkId,
        text: chunk.text,
        companyDomain,
        ingestedAt,
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        speakers: chunk.speakers,
        internalSpeakers: chunk.internalSpeakers,
        externalSpeakers: chunk.externalSpeakers,
      });
    }

    await db.deleteOtherChunks({ dataSource: "gong", sourceId: meta.id, currentIngestedAt: ingestedAt });
  }
}
