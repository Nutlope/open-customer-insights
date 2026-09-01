import Exa from "exa-js";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { generateText } from "ai";

// Strips boilerplate the LLM sometimes prepends despite being told to reply
// with only the description, e.g. "Here is a 1-2 sentence description of what
// X does:\n\n<actual description>" or "Here's the description:\n\n...".
export function stripDescriptionPreamble({ text }: { text: string }): string {
  return text
    .trim()
    .replace(/^Here(?:'s| is)\b[^\n]*:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

const ROUTER_URL = "https://whichllm.together.ai/router/fast";
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FALLBACK_MODEL = "Qwen/Qwen3.5-9B";
const MAX_CONTENT_CHARS = 4000;

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
  return FALLBACK_MODEL;
}

/**
 * Generates a short, factual description of what a company does (e.g.
 * "AI infrastructure provider", "agency building AI apps for clients",
 * "consumer fintech app") by reading their homepage via Exa and summarizing
 * it with an LLM. Returns null if no usable content or summary could be
 * produced.
 */
export async function generateCompanyDescription({
  name,
  domain,
  debug = false,
  exaApiKey = process.env.EXA_API_KEY,
  togetherApiKey = process.env.TOGETHER_API_KEY,
}: {
  name: string;
  domain: string;
  debug?: boolean;
  exaApiKey?: string;
  togetherApiKey?: string;
}): Promise<string | null> {
  if (!exaApiKey) throw new Error("EXA_API_KEY is required");
  if (!togetherApiKey) throw new Error("TOGETHER_API_KEY is required");

  const exa = new Exa(exaApiKey);
  let content = "";

  try {
    const { results } = await exa.getContents([`https://${domain}`], {
      text: { maxCharacters: MAX_CONTENT_CHARS },
    });
    content = results[0]?.text?.trim() ?? "";
    if (debug) console.log(`[enrichCompanyDescription] getContents(${domain}) -> ${content.length} chars`);
  } catch (err) {
    if (debug) console.error(`[enrichCompanyDescription] getContents failed for ${domain}:`, err);
  }

  if (!content) {
    try {
      const { results } = await exa.search(`${name} (${domain})`, {
        numResults: 3,
        type: "auto",
        contents: { text: { maxCharacters: 1500 } },
      });
      content = results
        .map((r) => r.text?.trim())
        .filter((text): text is string => !!text)
        .join("\n\n")
        .slice(0, MAX_CONTENT_CHARS);
      if (debug) console.log(`[enrichCompanyDescription] search fallback -> ${content.length} chars`);
    } catch (err) {
      if (debug) console.error(`[enrichCompanyDescription] search fallback failed for "${name}":`, err);
    }
  }

  if (!content) return null;

  const togetherai = createTogetherAI({ apiKey: togetherApiKey });
  const model = await getBestModel();
  if (debug) console.log(`[enrichCompanyDescription] using model: ${model}`);

  try {
    const { text } = await generateText({
      model: togetherai(model),
      prompt: [
        `Company name: "${name}" (${domain})`,
        `Website content:`,
        content,
        ``,
        `Write a 1-2 sentence description of what this company does, in plain English.`,
        `Be specific about its business model — e.g. an AI infrastructure/model provider, an agency or consultancy building products for other companies, a company with its own consumer/SaaS product, a GPU/cloud provider, etc.`,
        `Do not mention Together AI or use marketing language. Reply with only the description — no preamble like "Here is a description of..." and no introductory sentence, just start directly with the company name.`,
      ].join("\n"),
      maxOutputTokens: 120,
    });

    const description = stripDescriptionPreamble({ text });
    return description || null;
  } catch (err) {
    if (debug) console.error(`[enrichCompanyDescription] LLM generation failed for "${name}":`, err);
    return null;
  }
}
