export type Competitor = {
  name: string;
  domain: string;
  variants: string[];
};

export const COMPETITORS: Competitor[] = [
  {
    name: "Fireworks AI",
    domain: "fireworks.ai",
    variants: ["fireworks ai", "fireworks.ai", "fireworks"],
  },
  {
    name: "Baseten",
    domain: "baseten.co",
    variants: ["baseten", "base ten"],
  },
  {
    name: "Nebius",
    domain: "nebius.ai",
    variants: ["nebius"],
  },
  {
    name: "Modal",
    domain: "modal.com",
    variants: ["modal labs", "modal.com"],
  },
  {
    name: "Groq",
    domain: "groq.com",
    variants: ["groq"],
  },
  {
    name: "Replicate",
    domain: "replicate.com",
    variants: ["replicate.com", "replicate api"],
  },
  {
    name: "Anyscale",
    domain: "anyscale.com",
    variants: ["anyscale"],
  },
  {
    name: "RunPod",
    domain: "runpod.io",
    variants: ["runpod", "run pod"],
  },
  {
    name: "Lambda Labs",
    domain: "lambdalabs.com",
    variants: ["lambda labs", "lambdalabs", "lambda cloud"],
  },
  {
    name: "CoreWeave",
    domain: "coreweave.com",
    variants: ["coreweave", "core weave"],
  },
  {
    name: "SambaNova",
    domain: "sambanova.ai",
    variants: ["sambanova", "samba nova"],
  },
  {
    name: "Cerebras",
    domain: "cerebras.ai",
    variants: ["cerebras"],
  },
  {
    name: "OctoAI",
    domain: "octo.ai",
    variants: ["octoai", "octo ai", "octoml"],
  },
  {
    name: "Mistral AI",
    domain: "mistral.ai",
    // "mistral" alone excluded: too noisy as standalone; "mistralai/" model paths caught by word boundary
    variants: ["mistral ai", "mistral.ai"],
  },
  {
    name: "Cohere",
    domain: "cohere.com",
    variants: ["cohere"],
  },
  {
    name: "Perplexity",
    domain: "perplexity.ai",
    variants: ["perplexity"],
  },
  {
    name: "OpenAI",
    domain: "openai.com",
    // Removed raw GPT model names: they appear constantly as benchmarks/references, not switching intent.
    // "openai" still catches direct mentions; context rules below filter out SDK imports and model paths.
    variants: ["openai", "open ai", "chatgpt"],
  },
  {
    name: "Anthropic",
    domain: "anthropic.com",
    variants: ["anthropic"],
  },
  {
    name: "Vertex AI",
    domain: "cloud.google.com",
    variants: ["vertex ai", "google vertex", "google cloud ai"],
  },
  {
    name: "AWS Bedrock",
    domain: "aws.amazon.com",
    variants: ["aws bedrock", "amazon bedrock", "bedrock api"],
  },
  {
    name: "Azure AI",
    domain: "azure.microsoft.com",
    variants: ["azure ai", "azure openai", "microsoft azure ai"],
  },
];

// Characters that are considered "inside a word" — matches adjacent to these are skipped.
// Includes hyphen and underscore to avoid matching in slugs/URLs like "openai-whisper-v3" or "mistralai/model".
const WORD_CHARS = /[a-z0-9\-_]/;

function variantMatchesInText(lower: string, variant: string): boolean {
  const v = variant.toLowerCase();
  let idx = lower.indexOf(v);
  while (idx !== -1) {
    const charBefore = idx > 0 ? lower[idx - 1] : " ";
    const charAfter = idx + v.length < lower.length ? lower[idx + v.length] : " ";

    // Must be at a word boundary on both sides
    if (!WORD_CHARS.test(charBefore) && !WORD_CHARS.test(charAfter)) {
      // Skip model-namespace prefixes like "openai/gpt-oss-120b" or "anthropic/claude-3".
      // Only applies to non-domain variants (ones without ".") — domain variants like "mistral.ai"
      // appear in URLs where the trailing "/" is a path separator, not a model namespace.
      if (charAfter === "/" && !v.includes(".")) {
        idx = lower.indexOf(v, idx + 1);
        continue;
      }

      // Skip email addresses like "support@mistral.ai", "support@anthropic.com".
      // Emails in CC/BCC fields of forwarded tickets are not competitive signals.
      if (charBefore === "@") {
        idx = lower.indexOf(v, idx + 1);
        continue;
      }

      // Skip OpenAI SDK imports that Together AI itself documents: "from openai import ..."
      // These are Together customers using the OpenAI-compatible API, not switching to OpenAI.
      const contextBefore = lower.slice(Math.max(0, idx - 10), idx);
      if (contextBefore.endsWith("from ") || contextBefore.endsWith("import ")) {
        idx = lower.indexOf(v, idx + 1);
        continue;
      }

      // Skip code constructor calls like "OpenAI(" — Together's OpenAI-compatible SDK
      // uses `client = OpenAI(base_url="https://api.together.ai/v1", ...)`.
      // Natural language uses "OpenAI (" with a space, which still passes this check.
      if (charAfter === "(") {
        idx = lower.indexOf(v, idx + 1);
        continue;
      }

      return true;
    }

    idx = lower.indexOf(v, idx + 1);
  }
  return false;
}

// Returns a ~300-char window of text centered on the first real match of any variant,
// so snippets always show the word that triggered the detection rather than the chunk start.
export function findMentionSnippet({
  text,
  competitorName,
  windowSize = 300,
}: {
  text: string;
  competitorName: string;
  windowSize?: number;
}): string {
  const lower = text.toLowerCase();
  const competitor = COMPETITORS.find((c) => c.name === competitorName);
  if (!competitor) return text.slice(0, windowSize);

  // Find the earliest real match position across all variants
  let bestIdx = -1;
  outer: for (const variant of competitor.variants) {
    const v = variant.toLowerCase();
    let idx = lower.indexOf(v);
    while (idx !== -1) {
      const charBefore = idx > 0 ? lower[idx - 1] : " ";
      const charAfter = idx + v.length < lower.length ? lower[idx + v.length] : " ";
      if (!WORD_CHARS.test(charBefore) && !WORD_CHARS.test(charAfter)) {
        if (bestIdx === -1 || idx < bestIdx) bestIdx = idx;
        break outer; // first match is good enough
      }
      idx = lower.indexOf(v, idx + 1);
    }
  }

  if (bestIdx === -1) return text.slice(0, windowSize);

  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, bestIdx - half);
  const end = Math.min(text.length, start + windowSize);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}

export function detectCompetitorMentions({ text }: { text: string }): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const competitor of COMPETITORS) {
    for (const variant of competitor.variants) {
      if (variantMatchesInText(lower, variant)) {
        found.add(competitor.name);
        break;
      }
    }
  }
  return Array.from(found);
}
