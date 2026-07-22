import type { Doc } from "../../convex/_generated/dataModel";

type Call = Doc<"calls">;
type PylonIssue = Doc<"pylonIssues">;
type Chunk = Doc<"chunks">;

const RANK_FUSION_CONSTANT = 60;
const VECTOR_RANK_WEIGHT = 0.6;
const TEXT_RANK_WEIGHT = 0.4;

export interface SearchResult {
  dataSource: string;
  sourceId: string;
  sourceTitle: string;
  companyName: string | null;
  text: string;
  score: number;
  started: string | null;
  speakers: string[];
  startSec: number | null;
  endSec: number | null;
  // Gong speaker-affiliation buckets (distinct names). Default [] for
  // pre-backfill chunks and all pylon results. See SPEAKERS.md for the
  // mapping rule: Internal -> internalSpeakers, External -> externalSpeakers,
  // Unknown -> neither (renders "(Unverified)").
  internalSpeakers: string[];
  externalSpeakers: string[];
  createdAt: string | null;
  state: string | null;
  source: string | null;
  authors: string[];
  brief: string | null;
  keyPoints: string[] | null;
  topics: { name: string; duration: number }[] | null;
  issueCategory: string | null;
  priority: string | null;
  tags: string[];
}

interface RankedVectorChunk {
  chunk: Chunk;
  vectorScore: number;
}

interface HybridRankedChunk {
  chunk: Chunk;
  score: number;
}

interface RankHybridChunksParams {
  vectorChunks: RankedVectorChunk[];
  textChunks: Chunk[];
  limit: number;
}

interface ChunkRankAccumulator {
  chunk: Chunk;
  score: number;
}

interface MetadataMatchParams {
  fields: Array<string | undefined>;
  query: string;
}

interface CallSpeakerNamesParams {
  call: Pick<Call, "parties">;
}

const MIN_METADATA_QUERY_LENGTH = 3;
const METADATA_EXACT_SCORE = 100;
const METADATA_TOKEN_SCORE = 35;

function normalizeMetadataText({ value }: { value: string }): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactMetadataText({ value }: { value: string }): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function metadataTokens({ query }: { query: string }): string[] {
  return normalizeMetadataText({ value: query })
    .split(" ")
    .filter((token) => token.length >= MIN_METADATA_QUERY_LENGTH);
}

export function metadataMatchScore({
  fields,
  query,
}: MetadataMatchParams): number {
  const normalizedQuery = normalizeMetadataText({ value: query });
  const compactQuery = compactMetadataText({ value: query });
  if (normalizedQuery.length < MIN_METADATA_QUERY_LENGTH && compactQuery.length < MIN_METADATA_QUERY_LENGTH) {
    return 0;
  }

  const metadata = fields.filter((field): field is string => Boolean(field?.trim())).join(" ");
  if (!metadata) return 0;

  const normalizedMetadata = normalizeMetadataText({ value: metadata });
  const compactMetadata = compactMetadataText({ value: metadata });
  let score = 0;

  if (normalizedQuery && normalizedMetadata.includes(normalizedQuery)) {
    score += METADATA_EXACT_SCORE;
  }
  if (compactQuery.length >= MIN_METADATA_QUERY_LENGTH && compactMetadata.includes(compactQuery)) {
    score += METADATA_EXACT_SCORE;
  }

  const tokens = metadataTokens({ query });
  if (tokens.length > 0 && tokens.every((token) => normalizedMetadata.includes(token))) {
    score += METADATA_TOKEN_SCORE + tokens.length;
  }

  return score;
}

export function callSpeakerNames({ call }: CallSpeakerNamesParams): string[] {
  return [...new Set(
    call.parties
      .map((party) => party.name.trim())
      .filter(Boolean)
  )];
}

function rankScore({ rank, weight }: { rank: number; weight: number }): number {
  return weight / (RANK_FUSION_CONSTANT + rank);
}

export function rankHybridChunks({
  vectorChunks,
  textChunks,
  limit,
}: RankHybridChunksParams): HybridRankedChunk[] {
  const byChunkId = new Map<string, ChunkRankAccumulator>();

  vectorChunks.forEach(({ chunk, vectorScore }, index) => {
    const key = chunk._id.toString();
    const existing = byChunkId.get(key);
    const rank = index + 1;
    const score = rankScore({ rank, weight: VECTOR_RANK_WEIGHT }) + vectorScore * 0.001;
    if (existing) {
      existing.score += score;
    } else {
      byChunkId.set(key, { chunk, score });
    }
  });

  textChunks.forEach((chunk, index) => {
    const key = chunk._id.toString();
    const existing = byChunkId.get(key);
    const score = rankScore({ rank: index + 1, weight: TEXT_RANK_WEIGHT });
    if (existing) {
      existing.score += score;
    } else {
      byChunkId.set(key, { chunk, score });
    }
  });

  return [...byChunkId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function callToSearchResult(call: Call, overrides?: Partial<SearchResult>): SearchResult {
  return {
    dataSource: "gong",
    sourceId: call.gongId,
    sourceTitle: call.title,
    companyName: call.companyDomain ?? null,
    text: call.brief ?? "",
    score: 1,
    started: call.started,
    speakers: callSpeakerNames({ call }),
    startSec: null,
    endSec: null,
    internalSpeakers: [],
    externalSpeakers: [],
    createdAt: null,
    state: null,
    source: null,
    authors: [],
    brief: call.brief ?? null,
    keyPoints: call.keyPoints ?? null,
    topics: call.topics ?? null,
    issueCategory: null,
    priority: null,
    tags: [],
    ...overrides,
  };
}

export function issueToSearchResult(issue: PylonIssue, overrides?: Partial<SearchResult>): SearchResult {
  return {
    dataSource: "pylon",
    sourceId: issue.pylonId,
    sourceTitle: `#${issue.number} ${issue.title}`,
    companyName: issue.companyName ?? null,
    text: "",
    score: 1,
    started: null,
    speakers: [],
    startSec: null,
    endSec: null,
    internalSpeakers: [],
    externalSpeakers: [],
    createdAt: issue.createdAt,
    state: issue.state,
    source: issue.source,
    authors: [],
    brief: null,
    keyPoints: null,
    topics: null,
    issueCategory: issue.issueCategory ?? null,
    priority: issue.priority ?? null,
    tags: issue.tags ?? [],
    ...overrides,
  };
}

export function chunkToSearchResult(
  chunk: Doc<"chunks">,
  score: number,
  call?: Call | null,
  issue?: PylonIssue | null,
): SearchResult | null {
  if (chunk.dataSource === "gong") {
    return {
      dataSource: "gong",
      sourceId: chunk.sourceId,
      sourceTitle: call?.title ?? chunk.sourceId,
      companyName: chunk.companyDomain ?? call?.companyDomain ?? null,
      text: chunk.text,
      score,
      started: call?.started ?? null,
      speakers: chunk.speakers ?? [],
      startSec: chunk.startSec ?? null,
      endSec: chunk.endSec ?? null,
      internalSpeakers: chunk.internalSpeakers ?? [],
      externalSpeakers: chunk.externalSpeakers ?? [],
      createdAt: null,
      state: null,
      source: null,
      authors: [],
      brief: call?.brief ?? null,
      keyPoints: call?.keyPoints ?? null,
      topics: call?.topics ?? null,
      issueCategory: null,
      priority: null,
      tags: [],
    };
  }

  if (chunk.dataSource === "pylon") {
    return {
      dataSource: "pylon",
      sourceId: chunk.sourceId,
      sourceTitle: issue ? `#${issue.number} ${issue.title}` : chunk.sourceId,
      companyName: chunk.companyDomain ?? issue?.companyName ?? null,
      text: chunk.text,
      score,
      started: null,
      speakers: [],
      startSec: null,
      endSec: null,
      internalSpeakers: [],
      externalSpeakers: [],
      createdAt: issue?.createdAt ?? null,
      state: issue?.state ?? null,
      source: issue?.source ?? null,
      authors: chunk.authors ?? [],
      brief: null,
      keyPoints: null,
      topics: null,
      issueCategory: issue?.issueCategory ?? null,
      priority: issue?.priority ?? null,
      tags: issue?.tags ?? [],
    };
  }

  return null;
}

export function toInternalSource(source?: string): string | undefined {
  if (source === "calls") return "gong";
  if (source === "tickets") return "pylon";
  return undefined;
}

interface DateBoundParams {
  date?: string;
}

interface RangeParams {
  value: string | null;
  fromDate?: string;
  toDate?: string;
}

function isDateOnly(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function addOneDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

// Calls are stored with SF local time offsets (e.g. "2026-06-12T13:00:00.000-07:00").
// Date-only bounds like "2026-06-12" compare correctly via string prefix since stored
// dates already reflect SF calendar days. Full ISO timestamps are used as-is.
export function getDateLowerBound({ date }: DateBoundParams): string | undefined {
  return date;
}

export function getDateUpperBound({ date: toDate }: DateBoundParams): { value?: string; inclusive: boolean } {
  if (!toDate) return { inclusive: true };
  if (isDateOnly(toDate)) return { value: addOneDay(toDate), inclusive: false };
  return { value: toDate, inclusive: true };
}


export function isInRange({ value, fromDate, toDate }: RangeParams): boolean {
  const lower = getDateLowerBound({ date: fromDate });
  if (lower && value && value < lower) return false;
  const upper = getDateUpperBound({ date: toDate });
  if (upper.value && value) {
    if (upper.inclusive && value > upper.value) return false;
    if (!upper.inclusive && value >= upper.value) return false;
  }
  return true;
}
