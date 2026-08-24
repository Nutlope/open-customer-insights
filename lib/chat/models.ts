export const CHAT_MODELS = [
  {
    id: "zai-org/GLM-5.2",
    label: "GLM 5.2",
    provider: "Z.ai",
  },
  {
    id: "MiniMaxAI/MiniMax-M3",
    label: "MiniMax M3",
    provider: "MiniMax",
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Pro-0813",
    label: "DeepSeek V4 Pro 0813",
    provider: "DeepSeek",
  },
  {
    id: "moonshotai/Kimi-K2.6",
    label: "Kimi K2.6",
    provider: "Moonshot",
  },
] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];

export const DEFAULT_CHAT_MODEL_ID: ChatModelId = "zai-org/GLM-5.2";

export const CHAT_MODEL_IDS = CHAT_MODELS.map((model) => model.id) as [
  ChatModelId,
  ...ChatModelId[],
];

export function isChatModelId(value: unknown): value is ChatModelId {
  return (
    typeof value === "string" &&
    (CHAT_MODEL_IDS as readonly string[]).includes(value)
  );
}

// "Auto" lets Together's router pick the best-available model per request.
// It is a UI/selection sentinel, not a real Together model id — the server
// resolves it to a concrete model before calling the LLM.
export const AUTO_CHAT_MODEL_ID = "auto" as const;
export type AutoChatModelId = typeof AUTO_CHAT_MODEL_ID;

export type ChatModelSelection = ChatModelId | AutoChatModelId;

export const AUTO_CHAT_MODEL_OPTION = {
  id: AUTO_CHAT_MODEL_ID,
  label: "Auto",
  provider: "Together Router",
} as const;

// Options shown in the model picker: Auto first, then the explicit models.
export const CHAT_MODEL_OPTIONS = [AUTO_CHAT_MODEL_OPTION, ...CHAT_MODELS] as const;

export const DEFAULT_CHAT_MODEL_SELECTION: ChatModelSelection = AUTO_CHAT_MODEL_ID;

export function isChatModelSelection(value: unknown): value is ChatModelSelection {
  return value === AUTO_CHAT_MODEL_ID || isChatModelId(value);
}

// Resolves a concrete Together model id (e.g. one returned by the auto
// router) to the label shown in the model picker, falling back to the raw
// id for models not in our curated list.
export function getChatModelLabel({ modelId }: { modelId: string }): string {
  return CHAT_MODELS.find((model) => model.id === modelId)?.label ?? modelId;
}
