// Classifies sales-wins deals into a coarse revenue category + short label
// using Together AI, so the customer revenue timeline can distinguish
// inference workloads from GPU cluster/compute deals.
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

export type DealCategory = "inference" | "gpu_cluster" | "credits_other";

export type DealForCategorization = {
  opportunityName: string;
  opportunityType: "Net New" | "Expansion" | "Renewal";
  amount: number | null;
  businessUseCase?: string;
};

export type DealCategorization = {
  category: DealCategory;
  label: string;
};

const MODELS = [
  "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  "moonshotai/Kimi-K2.6",
] as const;

const batchResultSchema = z.object({
  results: z.array(z.object({
    index: z.number(),
    category: z.enum(["inference", "gpu_cluster", "credits_other"]),
    label: z.string(),
  })),
});

function buildPrompt({ batch }: { batch: DealForCategorization[] }): string {
  const lines = batch.map((d, i) => {
    const parts = [`${i}. "${d.opportunityName}"`, `type=${d.opportunityType}`];
    if (d.amount !== null) parts.push(`amount=$${d.amount.toLocaleString()}`);
    if (d.businessUseCase) parts.push(`use case: ${d.businessUseCase}`);
    return parts.join(" | ");
  });

  return [
    "You are categorizing closed-won sales deals for Together AI (a GPU cloud + AI inference platform) to build a per-customer revenue timeline.",
    "For each deal, assign:",
    '- "category": one of',
    '  - "inference": serverless or dedicated model inference, API/token usage, model hosting/endpoints',
    '  - "gpu_cluster": dedicated GPU compute clusters or instances for training, fine-tuning, or batch workloads',
    '  - "credits_other": generic credit packs, storage, ancillary charges, or anything that does not clearly indicate inference vs GPU clusters',
    '- "label": a short (under 6 words) human-readable description of what was sold, e.g. "256x H100 GPU cluster", "Dedicated inference endpoint", "Storage expansion", "$10K credit pack"',
    "",
    "Deals:",
    ...lines,
    "",
    "Return one result per deal, with the matching index.",
  ].join("\n");
}

export async function categorizeDeals({
  deals,
  togetherApiKey = process.env.TOGETHER_API_KEY,
  batchSize = 25,
}: {
  deals: DealForCategorization[];
  togetherApiKey?: string;
  batchSize?: number;
}): Promise<DealCategorization[]> {
  if (!togetherApiKey) throw new Error("TOGETHER_API_KEY is required");

  const togetherai = createOpenAICompatible({
    name: "togetherai",
    apiKey: togetherApiKey,
    baseURL: "https://api.together.xyz/v1",
    supportsStructuredOutputs: true,
  });

  const results: (DealCategorization | undefined)[] = new Array(deals.length);

  for (let start = 0; start < deals.length; start += batchSize) {
    const batch = deals.slice(start, start + batchSize);
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
    if (!parsed) throw lastError ?? new Error("All models failed to categorize deals");

    for (const r of parsed.results) {
      const deal = batch[r.index];
      if (!deal) continue;
      results[start + r.index] = { category: r.category, label: r.label };
    }
  }

  return results.map((r, i) => r ?? { category: "credits_other", label: deals[i]!.opportunityName });
}
