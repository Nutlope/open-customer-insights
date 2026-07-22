import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { SearchResult } from "../convex/search";
import { capToolOutput, previewText, type ToolOutputOptions } from "./output";

interface SearchParams {
  convex: ConvexHttpClient;
  clerkId?: string;
  serverSecret?: string;
  query?: string;
  source?: string; // "calls" | "tickets" | "all"
  limit?: number;
  offset?: number;
  fromDate?: string;
  toDate?: string;
  outputOptions?: ToolOutputOptions;
}

const SEARCH_RESULT_EXCERPT_CHARS = 800;

/**
 * Render the participants line for a Gong search result with affiliation
 * labels. Mirrors the SPEAKERS.md mapping rule:
 * - internalSpeakers  -> "(Internal)"
 * - externalSpeakers  -> "(Customer)"
 * - everyone else     -> "(Unverified)" ONLY when affiliation data exists;
 *   pre-backfill chunks (empty affiliation arrays) render names unlabeled so
 *   we never falsely mark known customers as unverified.
 */
function labeledParticipants({
  speakers,
  internalSpeakers,
  externalSpeakers,
}: {
  speakers: string[];
  internalSpeakers: string[];
  externalSpeakers: string[];
}): string[] {
  // Pre-backfill / no-affiliation-data: render names bare (never "(Unverified)").
  if (!internalSpeakers.length && !externalSpeakers.length) {
    return speakers;
  }
  const internalSet = new Set(internalSpeakers);
  const externalSet = new Set(externalSpeakers);
  return speakers.map((name) => {
    if (internalSet.has(name)) return `${name} (Internal)`;
    if (externalSet.has(name)) return `${name} (Customer)`;
    return `${name} (Unverified)`;
  });
}

interface QueryParams {
  query?: string;
}

interface ShorterQuerySuggestionParams extends QueryParams {
  resultCount: number;
  limit?: number;
}

function isLongQuery({ query }: QueryParams): boolean {
  if (!query) return false;
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.length >= 7;
}

function shouldSuggestShorterQuery({
  query,
  resultCount,
  limit,
}: ShorterQuerySuggestionParams): boolean {
  if (!isLongQuery({ query })) return false;
  return resultCount === 0 || (resultCount <= 2 && resultCount < (limit ?? 10));
}

export async function searchTool({
  convex,
  clerkId,
  serverSecret,
  query,
  source,
  limit,
  offset,
  fromDate,
  toDate,
  outputOptions,
}: SearchParams): Promise<string> {
  const effectiveLimit = limit ?? 10;
  const effectiveOffset = offset ?? 0;
  const results = (await convex.action(api.search.searchChunks, {
    clerkId,
    serverSecret,
    query: query || undefined,
    source,
    limit,
    offset,
    fromDate,
    toDate,
  })) as SearchResult[];

  if (!results.length) {
    if (shouldSuggestShorterQuery({ query, resultCount: results.length, limit })) {
      return "No results found.\n\n[Tip: This search used a long query. Retry with no query for source/date browsing, or use one short concrete phrase likely to appear in the transcript or ticket.]";
    }
    return "No results found.";
  }

  const truncated = results.length >= effectiveLimit;

  const body = results
    .map((r, i) => {
      const tag = r.dataSource === "gong" ? "[Call]" : "[Support]";
      const date = r.dataSource === "gong" ? r.started : r.createdAt;
      const dateStr = date ? ` — ${new Date(date).toLocaleDateString()}` : "";
      const stateStr = r.state ? ` [${r.state}]` : "";
      const companyStr = r.companyName ? ` (${r.companyName})` : "";
      const categoryStr = r.issueCategory ? ` [${r.issueCategory}]` : "";
      const priorityStr = r.priority ? ` P:${r.priority}` : "";
      const tagsStr = r.tags?.length ? ` tags:${r.tags.join(",")}` : "";
      let meta = `${tag} ${r.sourceTitle}${companyStr}${dateStr}${stateStr}${categoryStr}${priorityStr}${tagsStr}`;
      if (r.brief) meta += `\nSummary: ${r.brief}`;
      if (r.speakers.length) {
        const participants = r.dataSource === "gong"
          ? labeledParticipants({
              speakers: r.speakers,
              internalSpeakers: r.internalSpeakers,
              externalSpeakers: r.externalSpeakers,
            })
          : r.speakers;
        meta += `\nParticipants: ${participants.join(", ")}`;
      }
      if (r.keyPoints?.length)
        meta += `\nKey points: ${r.keyPoints.map((p) => `• ${p}`).join(" ")}`;
      if (r.topics?.length)
        meta += `\nTopics: ${r.topics.map((t) => `${t.name}(${Math.round(t.duration / 60)}m)`).join(", ")}`;
      const idTag = `[id:${r.dataSource === "gong" ? "call" : "support"}:${r.sourceId}]`;
      if (outputOptions?.mode === "compact") {
        const excerpt = previewText({ text: r.text, length: SEARCH_RESULT_EXCERPT_CHARS });
        return `${effectiveOffset + i + 1}. ${meta}\nExcerpt: ${excerpt}\n${idTag}`;
      }
      return `${effectiveOffset + i + 1}. ${meta}\n${r.text}\n${idTag}`;
    })
    .join("\n\n---\n\n");

  let output: string;
  if (truncated) {
    output = `${body}\n\n[Showing ${results.length} results at offset ${effectiveOffset} because the search limit was reached. This is NOT a total count; there may be more matching items. Do not tell the user there are exactly ${effectiveOffset + results.length}. For broad sweeps, call search again with limit ${effectiveLimit} and offset ${effectiveOffset + effectiveLimit}, or use a narrower date range.]`;
  } else if (shouldSuggestShorterQuery({ query, resultCount: results.length, limit })) {
    output = `${body}\n\n[Tip: This search used a long query and returned only ${results.length} result${results.length === 1 ? "" : "s"}. Retry with no query for source/date browsing, or use one short concrete phrase likely to appear in the transcript or ticket.]`;
  } else {
    output = body;
  }

  return capToolOutput({
    text: output,
    label: "Search output",
    guidance: "Use a narrower query, smaller limit, or fetch specific ids with get.",
    outputOptions,
  });
}
