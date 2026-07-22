const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 30_000;

export type ToolOutputOptions = {
  mode: "compact";
  maxChars?: number;
};

export const WEB_APP_TOOL_OUTPUT_OPTIONS: ToolOutputOptions = {
  mode: "compact",
  maxChars: DEFAULT_MAX_TOOL_OUTPUT_CHARS,
};

export function previewText({
  text,
  length,
}: {
  text: string;
  length: number;
}): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= length) return cleaned;
  return `${cleaned.slice(0, Math.max(0, length - 3)).trimEnd()}...`;
}

export function capToolOutput({
  text,
  label,
  guidance,
  outputOptions,
}: {
  text: string;
  label: string;
  guidance?: string;
  outputOptions?: ToolOutputOptions;
}): string {
  const maxChars = outputOptions?.maxChars;
  if (!maxChars) return text;
  if (text.length <= maxChars) return text;

  const note = guidance
    ? `${label} truncated to ${maxChars} chars to stay within storage limits. ${guidance}`
    : `${label} truncated to ${maxChars} chars to stay within storage limits.`;

  return `${text.slice(0, maxChars).trimEnd()}\n\n[${note}]`;
}
