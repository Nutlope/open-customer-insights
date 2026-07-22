"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReasoningUIPart, TextUIPart } from "ai";
import { MessageResponse } from "@/components/ai-elements/message";
import { Spinner } from "@/components/ui/spinner";

type ToolPart = {
  type: `tool-${string}`;
  state?: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  duration?: number;
};

type ThinkingSummaryPart = {
  type: "data-thinking-summary";
  data: {
    text: string;
    state: "streaming" | "done";
  };
};

type ModelResolvedPart = {
  type: "data-model-resolved";
  data: {
    modelId: string;
    label: string;
  };
};

export type ChatMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | ToolPart
  | ThinkingSummaryPart
  | ModelResolvedPart
  | { type: string };

export function getResolvedModelLabel({ parts }: { parts: ChatMessagePart[] }): string | null {
  const part = parts.find(
    (candidate): candidate is ModelResolvedPart => candidate.type === "data-model-resolved"
  );
  return part?.data.label ?? null;
}

function isTextPart(part: ChatMessagePart): part is TextUIPart {
  return part.type === "text";
}

function isThinkingPart(part: ChatMessagePart): boolean {
  return part.type === "reasoning" || part.type.startsWith("tool-");
}

function isThinkingSummaryPart(part: ChatMessagePart): part is ThinkingSummaryPart {
  return part.type === "data-thinking-summary";
}

function firstTextPartIndex({ parts }: { parts: ChatMessagePart[] }): number {
  return parts.findIndex((part) => isTextPart(part) && part.text.length > 0);
}

function lastThinkingPartIndex({ parts }: { parts: ChatMessagePart[] }): number {
  for (let index = parts.length - 1; index >= 0; index--) {
    if (isThinkingPart(parts[index]!)) return index;
  }
  return -1;
}

export function getPreOutputThinkingParts({ parts }: { parts: ChatMessagePart[] }): ChatMessagePart[] {
  return parts.filter(isThinkingPart);
}

export function getVisibleTextParts({
  messageRole,
  parts,
}: {
  messageRole: string;
  parts: ChatMessagePart[];
}): TextUIPart[] {
  if (messageRole !== "assistant") {
    return parts.filter(isTextPart);
  }

  const finalOutputStart = lastThinkingPartIndex({ parts }) + 1;

  return parts.slice(finalOutputStart).filter(isTextPart);
}

function latestThinkingSummary({ parts }: { parts: ChatMessagePart[] }): ThinkingSummaryPart | null {
  const firstTextIndex = firstTextPartIndex({ parts });
  const summarySearchEnd = firstTextIndex === -1 ? parts.length : firstTextIndex;

  for (let i = summarySearchEnd - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (isThinkingSummaryPart(part)) return part;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue({ value }: { value: unknown }): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shortValue({
  value,
  maxLength = 36,
}: {
  value: string;
  maxLength?: number;
}): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}

function formatDateValue({ value }: { value: string }): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function summarizeToolTitle({
  toolName,
  input,
}: {
  toolName: string;
  input: unknown;
}): string {
  if (toolName === "search" && isRecord(input)) {
    const query = stringValue({ value: input.query });
    const source = stringValue({ value: input.source }) ?? "all";
    return query ? `Searching ${source} for "${query}"` : `Browsing ${source}`;
  }

  if (toolName === "get" && isRecord(input)) {
    const id = stringValue({ value: input.id });
    return `Opening ${id ? shortValue({ value: id, maxLength: 28 }) : "source"}`;
  }

  if (toolName === "list_daily_insights") return "Listing daily insights";
  if (toolName === "list_prospects") return "Listing prospects";

  return `Used ${toolName.replaceAll("_", " ")}`;
}

function toolInputDetails({ input }: { input: unknown }): Array<{ label: string; value: string }> {
  if (!isRecord(input)) return [];

  return Object.entries(input)
    .map(([label, value]) => {
      const text =
        typeof value === "string"
          ? label === "from" || label === "to"
            ? formatDateValue({ value })
            : shortValue({ value, maxLength: 48 })
          : typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : null;
      return text ? { label, value: text } : null;
    })
    .filter((item): item is { label: string; value: string } => item !== null);
}

function summarizeToolOutput({ output }: { output: unknown }): string | null {
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (!trimmed) return null;

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return `${parsed.length} result${parsed.length === 1 ? "" : "s"}`;
      if (isRecord(parsed)) {
        const keys = Object.keys(parsed);
        return keys.length ? `Returned ${keys.join(", ")}` : "Returned details";
      }
    } catch {}

    return trimmed.length > 220 ? `${trimmed.slice(0, 220)}...` : trimmed;
  }

  if (Array.isArray(output)) return `${output.length} result${output.length === 1 ? "" : "s"}`;

  if (isRecord(output)) {
    const keys = Object.keys(output);
    return keys.length ? `Returned ${keys.join(", ")}` : "Returned details";
  }

  return null;
}

function ThinkingDisclosure({
  title,
  children,
  isActive = false,
}: {
  title: string;
  children: React.ReactNode;
  isActive?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(isActive);
  const wasActive = useRef(isActive);

  useEffect(() => {
    if (isActive) {
      setIsOpen(true);
    } else if (wasActive.current) {
      setIsOpen(false);
    }
    wasActive.current = isActive;
  }, [isActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center gap-1.5 text-left text-xs font-medium text-zinc-400 transition-[color] hover:text-zinc-600"
      >
        <ChevronDownIcon className={`size-3 shrink-0 transition-transform ${isOpen ? "rotate-180" : "-rotate-90"}`} />
        <span className="flex min-w-0 flex-1 items-center">
          <span className="truncate">{title}</span>
        </span>
        {isActive && <Spinner className="size-3 shrink-0 text-zinc-500" />}
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-1 max-w-full text-xs leading-5 text-zinc-500">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThinkingTextDisclosure({
  text,
  isActive = false,
}: {
  text: string;
  isActive?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const previewText = text.replace(/\s+/g, " ").trim();

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-start gap-1.5 text-left text-sm leading-6 text-zinc-500 transition-[color] hover:text-zinc-700"
      >
        <ChevronDownIcon className={`mt-1.5 size-3.5 shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-180" : "-rotate-90"}`} />
        <span className="min-w-0 flex-1 truncate">{previewText || "Reasoning details"}</span>
        {isActive && <Spinner className="mt-1.5 size-3.5 shrink-0 text-zinc-500" />}
      </button>
      {isOpen && (
        <div className="mt-1 pl-5 text-sm leading-6 text-zinc-500">
          <MessageResponse className="text-sm leading-6 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:max-h-56 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-100 [&_pre]:p-2 [&_pre]:text-xs">
            {text}
          </MessageResponse>
        </div>
      )}
    </div>
  );
}

function WorkingLabel({
  isStreaming,
  shouldReduceMotion,
}: {
  isStreaming: boolean;
  shouldReduceMotion: boolean | null;
}) {
  if (!isStreaming || shouldReduceMotion) {
    return <span className="text-sm font-semibold text-zinc-700">{isStreaming ? "Working" : "Steps"}</span>;
  }

  return (
    <motion.span
      className="bg-[linear-gradient(90deg,#71717a_0%,#18181b_45%,#71717a_90%)] bg-[length:220%_100%] bg-clip-text text-sm font-semibold text-transparent"
      animate={{ backgroundPosition: ["120% 0%", "-120% 0%"] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
    >
      Working
    </motion.span>
  );
}

export function ThinkingSteps({
  parts,
  isStreaming,
}: {
  parts: ChatMessagePart[];
  isStreaming: boolean;
}) {
  const steps = parts.filter(isThinkingPart);
  const summary = latestThinkingSummary({ parts });
  const summaryText = summary?.data.text ?? (isStreaming ? "Working through the request." : "Done.");
  const activeSummaryText = isStreaming ? `${summaryText.replace(/[.\s]+$/g, "")}...` : summaryText;
  const [isOpen, setIsOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  if (steps.length === 0) return null;

  const toolCount = steps.filter((p) => p.type.startsWith("tool-")).length;
  const thoughtCount = steps.filter((p) => p.type === "reasoning").length;
  const countParts = [
    thoughtCount > 0 ? `${thoughtCount} thought${thoughtCount === 1 ? "" : "s"}` : null,
    toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const activeStepIndex = isStreaming ? steps.length - 1 : -1;

  return (
    <div className="not-prose mb-3">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex w-full max-w-full cursor-pointer items-start gap-2 rounded-md px-0 py-1.5 text-left transition-[color] hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <WorkingLabel isStreaming={isStreaming} shouldReduceMotion={shouldReduceMotion} />
            {countParts.length > 0 && (
              <span className="truncate text-sm text-zinc-400">{countParts.join(", ")}</span>
            )}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-sm leading-6 text-zinc-500">
            {isStreaming && <Spinner className="size-3.5 shrink-0 text-zinc-400" />}
            <span className="min-w-0 text-pretty">{activeSummaryText}</span>
          </span>
        </span>
        <ChevronDownIcon className={`mt-1.5 size-4 shrink-0 text-zinc-400 transition-transform group-hover:text-zinc-600 ${isOpen ? "rotate-180" : "-rotate-90"}`} />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
            className="mt-1 space-y-2 overflow-hidden border-l border-zinc-200 pl-3"
          >
            {steps.map((part, index) => {
              if (part.type === "reasoning") {
                const reasoningPart = part as ReasoningUIPart;
                return (
                  <ThinkingTextDisclosure
                    key={index}
                    text={reasoningPart.text}
                    isActive={index === activeStepIndex}
                  />
                );
              }
              const toolPart = part as ToolPart;
              const toolName = toolPart.type.replace("tool-", "");
              const details = toolInputDetails({ input: toolPart.input });
              const outputSummary = summarizeToolOutput({ output: toolPart.output });
              return (
                <ThinkingDisclosure
                  key={index}
                  title={summarizeToolTitle({ toolName, input: toolPart.input })}
                  isActive={index === activeStepIndex}
                >
                  <div className="space-y-2">
                    {details.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {details.map((detail) => (
                          <span
                            key={`${detail.label}-${detail.value}`}
                            className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500"
                          >
                            <span className="text-zinc-400">{detail.label}</span> {detail.value}
                          </span>
                        ))}
                      </div>
                    ) : toolPart.state !== "output-available" ? (
                      <p>Running tool...</p>
                    ) : null}
                    {toolPart.state === "output-available" && outputSummary && (
                      <pre className="line-clamp-4 whitespace-pre-wrap rounded-md bg-zinc-100 px-2 py-1.5 font-mono text-xs leading-5 text-zinc-600 shadow-[inset_0_0_0_1px_rgba(24,24,27,0.08)]">
                        {outputSummary}
                      </pre>
                    )}
                    {toolPart.state === "output-error" && <p className="text-rose-600">Tool returned an error.</p>}
                  </div>
                </ThinkingDisclosure>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
