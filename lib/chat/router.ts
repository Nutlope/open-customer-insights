import { DEFAULT_CHAT_MODEL_ID } from "./models";

const ROUTER_BEST_URL = "https://whichllm.together.ai/router/best";
const ROUTER_TIMEOUT_MS = 4000;

type RouterBestResponse = {
  mode?: string;
  model?: string;
  modelName?: string;
  uptimeFloor?: number;
  generatedAt?: string;
};

// Resolves the "Auto" selection to a concrete Together model id via Together's
// router. Falls back to the default model on any failure (network, timeout,
// non-2xx, or an empty payload) so a router hiccup never blocks chat.
export async function resolveBestChatModelId(): Promise<string> {
  try {
    const response = await fetch(ROUTER_BEST_URL, {
      signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) return DEFAULT_CHAT_MODEL_ID;
    const data = (await response.json()) as RouterBestResponse;
    return data.model?.trim() || DEFAULT_CHAT_MODEL_ID;
  } catch {
    return DEFAULT_CHAT_MODEL_ID;
  }
}
