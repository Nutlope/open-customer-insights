// Best-effort LLM guess at a company's website domain, used only as a hint
// for the manual-review queue (convex/salesWins.ts pendingRevenueDeals) when
// a closed-won deal's company can't be matched against an existing
// companyProfiles record and the Slack message has no usable domain link.
// Never applied automatically — a maintainer confirms or overrides it.
import { generateText, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

export type DomainGuess = {
  domain: string | null;
  confidence: "high" | "medium" | "low";
};

const resultSchema = z.object({
  domain: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

export async function guessCompanyDomain({
  companyName,
  businessUseCase,
  togetherApiKey = process.env.TOGETHER_API_KEY,
}: {
  companyName: string;
  businessUseCase?: string;
  togetherApiKey?: string;
}): Promise<DomainGuess> {
  if (!togetherApiKey) throw new Error("TOGETHER_API_KEY is required");

  const togetherai = createOpenAICompatible({
    name: "togetherai",
    apiKey: togetherApiKey,
    baseURL: "https://api.together.xyz/v1",
    supportsStructuredOutputs: true,
  });

  const prompt = [
    `What is the primary website domain (e.g. "example.com") for the company "${companyName}"?`,
    businessUseCase ? `Context on what they use Together AI (a GPU cloud + AI inference platform) for: ${businessUseCase}` : undefined,
    "Only answer with a domain if you clearly recognize this specific company and are confident. If you don't recognize it, aren't sure which company this refers to, or it could be several different companies, return null for domain rather than guessing.",
  ].filter(Boolean).join("\n");

  const { output } = await generateText({
    model: togetherai("meta-llama/Llama-3.3-70B-Instruct-Turbo"),
    output: Output.object({ schema: resultSchema }),
    prompt,
  });

  return output;
}
