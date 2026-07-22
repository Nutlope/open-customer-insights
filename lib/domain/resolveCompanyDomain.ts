import Exa from "exa-js";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { generateText } from "ai";

const ROUTER_URL = "https://whichllm.together.ai/router/fast";
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedModel: { id: string; fetchedAt: number } | null = null;

async function getBestModel(): Promise<string> {
  const now = Date.now();
  if (cachedModel && now - cachedModel.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cachedModel.id;
  }
  try {
    const res = await fetch(ROUTER_URL);
    const json = (await res.json()) as { model?: string };
    if (json.model) {
      cachedModel = { id: json.model, fetchedAt: now };
      return json.model;
    }
  } catch {
    // fall through to fallback
  }
  return "openai/gpt-oss-20b";
}

function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function looksLikeValidDomain(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
    s.replace(/^www\./, "")
  );
}

/**
 * Normalise a messy Clay/Salesforce company name into one or two clean search
 * terms. Returns the primary term first, an alternate second (if any).
 *
 * Examples:
 *   "Sunday Robotics/Lemi Bot"        → ["Lemi Bot", "Sunday Robotics"]
 *   "Noxie Innovation (Nutron AI)"    → ["Nutron AI", "Noxie Innovation"]
 *   "Clarity / Transluce"             → ["Clarity", "Transluce"]
 *   "Black Forest Labs"               → ["Black Forest Labs"]
 */
function normaliseNameForSearch(name: string): [string, string | undefined] {
  // Strip trailing/leading whitespace
  name = name.trim();

  // Handle "Primary / Secondary" or "Primary/Secondary" splits
  const slashParts = name.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
  if (slashParts.length >= 2) {
    // Prefer the shorter, more specific part as the primary search term
    const sorted = [...slashParts].sort((a, b) => a.length - b.length);
    return [sorted[0]!, sorted[1]];
  }

  // Handle "Primary (AKA name)" — use the parenthetical as primary
  const parenMatch = name.match(/^(.+?)\s*\((.+?)\)\s*$/);
  if (parenMatch) {
    return [parenMatch[2]!.trim(), parenMatch[1]!.trim()];
  }

  return [name, undefined];
}

export async function resolveCompanyDomain({
  name,
  websiteHint,
  debug = false,
  exaApiKey = process.env.EXA_API_KEY,
  togetherApiKey = process.env.TOGETHER_API_KEY,
}: {
  name: string;
  websiteHint?: string;
  debug?: boolean;
  exaApiKey?: string;
  togetherApiKey?: string;
}): Promise<string | null> {
  if (!exaApiKey) throw new Error("EXA_API_KEY is required");
  if (!togetherApiKey) throw new Error("TOGETHER_API_KEY is required");

  // Fast path: if hint already looks like a valid domain, trust it
  if (websiteHint) {
    const hintDomain = extractDomain(websiteHint);
    if (hintDomain && looksLikeValidDomain(hintDomain)) {
      return hintDomain;
    }
  }

  const [primary, alternate] = normaliseNameForSearch(name);
  const exa = new Exa(exaApiKey);
  let candidates: string[] = [];

  // Search with primary term, optionally a second pass with alternate
  const searchTerms = [primary, ...(alternate ? [alternate] : [])];

  for (const term of searchTerms) {
    try {
      const results = await exa.search(`${term} official website`, {
        numResults: 5,
        type: "auto",
      });

      const found = results.results
        .map((r) => extractDomain(r.url))
        .filter((d): d is string => d !== null && looksLikeValidDomain(d))
        .filter((d, i, arr) => arr.indexOf(d) === i)
        .filter((d) => !candidates.includes(d));

      if (debug) {
        console.log(`  [exa "${term}"] candidates: ${found.join(", ")}`);
      }

      candidates.push(...found);
      // Stop early if we already have good coverage
      if (candidates.length >= 5) break;
    } catch (err) {
      console.error(`[resolveCompanyDomain] Exa search failed for "${term}":`, err);
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // LLM rerank: pick the canonical domain from candidates
  const togetherai = createTogetherAI({ apiKey: togetherApiKey });
  const model = await getBestModel();
  if (debug) console.log(`  [router] using model: ${model}`);

  try {
    const nameContext = primary !== name ? `Company name: "${name}" (also known as "${primary}")` : `Company name: "${name}"`;
    const { text } = await generateText({
      model: togetherai(model),
      prompt: [
        nameContext,
        `Candidate domains found via web search: ${candidates.join(", ")}`,
        `Which single domain is the official homepage for this company?`,
        `Reply with only the domain (e.g. "cursor.com") or "null" if none are a confident match.`,
      ].join("\n"),
      maxOutputTokens: 20,
    });

    const picked = text.trim().replace(/^["']|["']$/g, "").toLowerCase();
    if (debug) console.log(`  [llm] picked: "${picked}" from [${candidates.join(", ")}]`);

    if (picked === "null" || picked === "") return null;

    const match = candidates.find(
      (c) => c === picked || picked.endsWith(c) || c.endsWith(picked)
    );
    return match ?? candidates[0]!;
  } catch (err) {
    console.error(`[resolveCompanyDomain] LLM rerank failed for "${name}":`, err);
    return candidates[0]!;
  }
}
