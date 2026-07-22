import { z } from "zod";

export const SEARCH_TOOL_USAGE_GUIDANCE = `IMPORTANT: The query parameter is a semantic content search, not a restatement of the user's whole request. Omit query for inventory, counts, listing, or browsing by source/date (for example "calls last month" should use source/from/to only). Do not put abstract analysis categories, user intents, sentiment labels, or report-section labels in query. Instead, translate them into one short concrete evidence phrase likely to appear in a transcript or ticket. For example, instead of querying "negative feedback", search for phrases like "bad performance", "cancel", or "poor reliability"; instead of "positive feedback", search for phrases like "working well", "easy to use", or "great support"; instead of "feature requests", search for a concrete requested capability if the user named one.

Use only one search concept per call. Do NOT pass comma-separated terms (e.g. "HIPAA, serverless, rate limits") - the query is semantic and treats the entire string as one phrase, so comma-separated terms return poor results. If you need results for multiple topics, make separate parallel calls instead.

For "every customer that mentioned X" or other broad topic sweeps, use a short concrete query for X, set limit to 200, and continue with offset 200, 400, etc. until a page returns fewer than the requested limit. Deduplicate companies by companyName/domain before answering.

Call participants are labeled (Together) for Together AI employees, (Customer) for external customers, and (Unverified) when affiliation is unknown. Transcript lines are prefixed with the speaker's name. Lines spoken by (Together) participants are the rep's pitch or paraphrase — do NOT quote or count them as customer feedback, requests, or sentiment. Only attribute needs to lines spoken by (Customer) participants; treat (Unverified) speakers as possibly-customer. Rep lines remain useful context for what the customer was responding to.`;

export const SEARCH_TOOL_DESCRIPTION = `Semantic search over customer calls and support tickets.
Returns lightweight summaries - titles, dates, companies, briefs, key points.
Use this first to discover relevant items, then call get for full content.

${SEARCH_TOOL_USAGE_GUIDANCE}

source: "calls" = calls only, "tickets" = tickets only, "all" = both (default).
from/to: ISO 8601 date range, e.g. "2026-01-01T00:00:00Z".
limit: page size, not a total count. If search returns exactly the requested limit, assume there may be more results. Do not report "there are N" from a limit-sized response; say "at least N shown" or call again with a higher offset / a narrower date range.
offset: number of ranked results to skip for pagination. Use 0 or omit for the first page, then increment by limit.

Examples:
- "complaints about inference speed" -> query that, source "all"
- "calls this week" -> omit query, source "calls", from/to for the week
- "how many calls last month?" -> omit query, source "calls", from/to for last month, limit 200
- "open support tickets last month" -> omit query, source "tickets", from/to for last month
- "every customer mentioning voice models" -> query "voice models", limit 200, offset 0; if the page is full, repeat with offset 200
- "negative feedback last week" -> do not query "negative feedback"; make focused calls such as query "bad performance", "cancel", or "poor reliability" with from/to
- "feature requests last month" -> do not query "feature requests"; use a named capability if provided, otherwise browse the date range and inspect likely results
- WRONG: "HIPAA, serverless, rate limits" -> makes one nonsense phrase
- RIGHT: three separate calls with "HIPAA compliance", "serverless endpoints", "rate limits"`;

export const searchInputSchemaFields = {
  query: z.string().optional().describe("Optional semantic content phrase. Omit for counts, lists, inventory, or browsing by source/date only. Do not restate the user's request. Do not use abstract categories, user intents, sentiment labels, or report-section labels such as 'negative feedback', 'positive feedback', 'main takeaways', 'feature requests', or 'calls last month'. Translate the need into one concrete phrase likely to appear in content, e.g. 'bad performance', 'cancel', 'poor reliability', 'working well', or a named product capability. For multiple concepts, make separate calls."),
  source: z.enum(["calls", "tickets", "all"]).optional().describe('"calls" = calls only, "tickets" = tickets only, "all" = both (default)'),
  from: z.string().optional().describe("ISO 8601 start date"),
  to: z.string().optional().describe("ISO 8601 end date"),
  limit: z.number().int().min(1).max(200).optional().describe("Page size, not a total count (default 10, max 200). For broad 'every customer mentioning X' sweeps, request 200 results per page. If returned results equal this limit, there may be more."),
  offset: z.number().int().min(0).optional().describe("Number of ranked results to skip for pagination. Use 0 or omit first, then increment by limit while a page comes back full."),
};

export const searchInputSchema = z.object(searchInputSchemaFields);

export const GET_TOOL_DESCRIPTION = `Fetch the full content of a call or support ticket.
For calls: returns the full transcript with all speaker turns.
For support tickets: returns the full message thread.

Pass the [id:...] tag from a search result exactly as-is.
Examples: "call:abc123", "support:xyz456"`;

export const getInputSchemaFields = {
  id: z.string().describe('The [id:...] from a search result, e.g. "call:abc123" or "support:xyz456"'),
};

export const getInputSchema = z.object(getInputSchemaFields);
