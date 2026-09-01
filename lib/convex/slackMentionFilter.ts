// Filters keyword-matched Slack mention candidates (see
// convex/slackMentions.ts) down to ones that genuinely discuss a watchlisted
// company as a business, using a cheap/fast Together AI model. This catches
// the noise that survives plain term-matching: AI model names that collide
// with company names in automated benchmark posts, generic English words,
// and references to unrelated entities that happen to share a name.
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

export type SlackMentionCandidate = {
  text: string;
  companyName: string;
  domain: string;
  matchedTerms: string[];
};

const MODELS = [
  "moonshotai/Kimi-K2.6",
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "Qwen/Qwen3.5-9B",
] as const;

const MAX_MESSAGE_CHARS = 500;

const batchResultSchema = z.object({
  results: z.array(z.object({
    index: z.number(),
    isGenuineMention: z.boolean(),
  })),
});

function buildPrompt({ batch }: { batch: SlackMentionCandidate[] }): string {
  const lines = batch.map((candidate, i) => [
    `${i}. company="${candidate.companyName}" (${candidate.domain}), matched term(s): ${candidate.matchedTerms.join(", ")}`,
    `   message: "${candidate.text.slice(0, MAX_MESSAGE_CHARS)}"`,
  ].join("\n"));

  return [
    "You are filtering a daily scan of Together AI's internal Slack for genuine mentions of customer/prospect companies.",
    "Together AI is a GPU cloud + AI inference platform. Its Slack is full of internal jargon, automated bot reports about AI model benchmarks (model names can look like company names), and generic English words that coincidentally match a company's name or domain.",
    "For each item, a keyword matched the company's name or domain in a Slack message. Decide whether the message GENUINELY discusses that company as a business — e.g. as a customer, prospect, deal, support issue, product feedback, meeting, or intro.",
    "Answer false if: the matched term is a coincidental/generic word unrelated to the company, the message is an automated bot/monitoring report about an AI model that happens to share the company's name, or the term refers to a different entity entirely.",
    "Be especially skeptical when the matched term is also an ordinary English word or common tech/business term (examples: \"insights\", \"slack\", \"target\", \"daily\", \"create\", \"sweep\", \"output\", \"handoff\", \"tomorrow\", \"reach\", \"github\", \"disco\", \"all hands\"). In these cases, only answer true if the message text itself makes clear it's about that specific company (e.g. it names the company, references its product/domain, or discusses it as an account/deal) — not just because the word appears in its everyday sense.",
    "When in doubt, answer false — missing a real mention is far cheaper than surfacing noise.",
    "",
    ...lines,
    "",
    "Return one result per item with the matching index and isGenuineMention (true/false).",
  ].join("\n");
}

// Returns one boolean per candidate (same order/length as `candidates`):
// true if the message genuinely discusses that company as a business.
export async function filterGenuineCompanyMentions({
  candidates,
  togetherApiKey = process.env.TOGETHER_API_KEY,
  batchSize = 25,
}: {
  candidates: SlackMentionCandidate[];
  togetherApiKey?: string;
  batchSize?: number;
}): Promise<boolean[]> {
  if (candidates.length === 0) return [];
  if (!togetherApiKey) throw new Error("TOGETHER_API_KEY is required");

  const togetherai = createOpenAICompatible({
    name: "togetherai",
    apiKey: togetherApiKey,
    baseURL: "https://api.together.xyz/v1",
    supportsStructuredOutputs: true,
  });

  const results: (boolean | undefined)[] = new Array(candidates.length);

  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = candidates.slice(start, start + batchSize);
    const prompt = buildPrompt({ batch });

    let lastError: Error | null = null;
    let parsed: z.infer<typeof batchResultSchema> | null = null;
    for (const model of MODELS) {
      try {
        const { output } = await generateText({
          model: togetherai(model),
          output: Output.object({ schema: batchResultSchema }),
          prompt,
        });
        parsed = output;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    if (!parsed) throw lastError ?? new Error("All models failed to filter Slack mentions");

    for (const r of parsed.results) {
      if (batch[r.index]) results[start + r.index] = r.isGenuineMention;
    }
  }

  return results.map((r) => r ?? false);
}
