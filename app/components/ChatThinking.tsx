"use client";

import { useState } from "react";
import {
  BrainIcon,
  ChevronRightIcon,
  FileTextIcon,
  ListIcon,
  SearchIcon,
  WrenchIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReasoningUIPart, TextUIPart } from "ai";
import { MessageResponse } from "@/components/ai-elements/message";

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
  if (toolName === "search") {
    if (isRecord(input)) {
      const query = stringValue({ value: input.query });
      const source = stringValue({ value: input.source }) ?? "all";
      if (query) return `Searching ${source} for "${query}"`;
      return `Browsing ${source}`;
    }
    return "Searching";
  }

  if (toolName === "get") {
    const id = isRecord(input) ? stringValue({ value: input.id }) : null;
    return `Reading ${id ? shortValue({ value: id, maxLength: 28 }) : "a source"}`;
  }

  return `Running ${toolName.replaceAll("_", " ")}`;
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

function latestThinkingSummary({ parts }: { parts: ChatMessagePart[] }): ThinkingSummaryPart | null {
  const firstTextIndex = firstTextPartIndex({ parts });
  const summarySearchEnd = firstTextIndex === -1 ? parts.length : firstTextIndex;

  for (let i = summarySearchEnd - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (isThinkingSummaryPart(part)) return part;
  }

  return null;
}

/* The one-line status shown while the model is still working: the most recent
   meaningful activity, walking backwards through the raw parts stream. */
function liveActivityText({ parts }: { parts: ChatMessagePart[] }): string {
  const firstTextIndex = firstTextPartIndex({ parts });
  const searchEnd = firstTextIndex === -1 ? parts.length : firstTextIndex;

  for (let i = searchEnd - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (isThinkingSummaryPart(part)) {
      const text = part.data.text.replace(/[.\s]+$/g, "");
      if (text) return text;
    }
    if (part.type.startsWith("tool-")) {
      const toolPart = part as ToolPart;
      return summarizeToolTitle({
        toolName: toolPart.type.replace("tool-", ""),
        input: toolPart.input,
      });
    }
    if (part.type === "reasoning") return "Thinking";
  }

  return "Thinking";
}

type StepKind = "reasoning" | "search" | "get" | "list" | "tool";

function stepKind({ part }: { part: ChatMessagePart }): StepKind {
  if (part.type === "reasoning") return "reasoning";
  const toolName = part.type.replace("tool-", "");
  if (toolName === "search") return "search";
  if (toolName === "get") return "get";
  if (toolName.startsWith("list")) return "list";
  return "tool";
}

const stepIcons: Record<StepKind, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  reasoning: BrainIcon,
  search: SearchIcon,
  get: FileTextIcon,
  list: ListIcon,
  tool: WrenchIcon,
};

const detailEase = [0.32, 0.72, 0, 1] as const;

function ThinkingStep({
  part,
  isActive,
  shouldReduceMotion,
}: {
  part: ChatMessagePart;
  isActive: boolean;
  shouldReduceMotion: boolean | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const kind = stepKind({ part });
  const Icon = stepIcons[kind];

  const isReasoning = kind === "reasoning";
  const reasoningText = isReasoning ? (part as ReasoningUIPart).text : "";
  const toolPart = isReasoning ? null : (part as ToolPart);
  const isToolError = toolPart?.state === "output-error";

  const title = isReasoning
    ? reasoningText.replace(/\s+/g, " ").trim() || "Thinking"
    : summarizeToolTitle({
        toolName: toolPart!.type.replace("tool-", ""),
        input: toolPart!.input,
      });

  const details = toolPart ? toolInputDetails({ input: toolPart.input }) : [];
  const outputSummary = toolPart ? summarizeToolOutput({ output: toolPart.output }) : null;

  return (
    <div className="animate-step-in">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="group/step flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-[5px] text-left transition-[background-color] duration-150 hover:bg-zinc-200/50"
      >
        <Icon
          className={`size-3.5 shrink-0 ${isToolError ? "text-rose-500" : "text-zinc-400"}`}
          strokeWidth={1.8}
        />
        {isActive && !shouldReduceMotion ? (
          <span className="text-shimmer min-w-0 flex-1 truncate text-sm leading-5">{title}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm leading-5 text-zinc-500 transition-[color] group-hover/step:text-zinc-800">
            {title}
          </span>
        )}
        <ChevronRightIcon
          className={`size-3.5 shrink-0 text-zinc-300 transition-[rotate,color] duration-200 group-hover/step:text-zinc-500 ${isOpen ? "rotate-90" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: detailEase }}
            className="overflow-hidden"
          >
            <div className="space-y-2 py-1.5 pl-[30px] pr-2">
              {isReasoning ? (
                <MessageResponse variant="compact">
                  {reasoningText}
                </MessageResponse>
              ) : (
                <>
                  {details.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {details.map((detail) => (
                        <span
                          key={`${detail.label}-${detail.value}`}
                          className="rounded-md bg-white px-1.5 py-0.5 text-xs leading-5 text-zinc-500 border border-zinc-200/80"
                        >
                          <span className="text-zinc-400">{detail.label}</span> {detail.value}
                        </span>
                      ))}
                    </div>
                  ) : toolPart?.state !== "output-available" && !isToolError ? (
                    <p className="text-sm text-zinc-400">Waiting for the tool to finish...</p>
                  ) : null}
                  {toolPart?.state === "output-available" && outputSummary && (
                    <pre className="line-clamp-4 whitespace-pre-wrap rounded-md bg-white px-2.5 py-1.5 font-mono text-xs leading-5 text-zinc-500 border border-zinc-200/80">
                      {outputSummary}
                    </pre>
                  )}
                  {isToolError && <p className="text-sm text-rose-600">Tool returned an error.</p>}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ThinkingSteps({
  parts,
  isStreaming,
}: {
  parts: ChatMessagePart[];
  isStreaming: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const steps = parts.filter(isThinkingPart);

  if (steps.length === 0) return null;

  const doneSummary = latestThinkingSummary({ parts })?.data.text.replace(/[.\s]+$/g, "");
  const stepsLabel = `${steps.length} step${steps.length === 1 ? "" : "s"}`;
  const collapsedLabel = isStreaming
    ? liveActivityText({ parts })
    : doneSummary || "Worked through the request";
  const activeStepIndex = isStreaming ? steps.length - 1 : -1;

  return (
    <div className="not-prose mb-3">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="group/trace flex h-8 w-full min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
      >
        {isStreaming && !shouldReduceMotion ? (
          <span className="text-shimmer min-w-0 truncate text-sm font-medium leading-5">
            {collapsedLabel}
          </span>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium leading-5 text-zinc-500 transition-[color] group-hover/trace:text-zinc-800">
            {collapsedLabel}
          </span>
        )}
        {!isStreaming && (
          <span className="shrink-0 text-sm leading-5 text-zinc-400">· {stepsLabel}</span>
        )}
        <ChevronRightIcon
          className={`size-3.5 shrink-0 text-zinc-400 transition-[rotate,color] duration-200 group-hover/trace:text-zinc-600 ${isOpen ? "rotate-90" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: detailEase }}
            className="overflow-hidden"
          >
            <div className="mb-1 mt-0.5 space-y-px">
              {steps.map((part, index) => (
                <ThinkingStep
                  key={index}
                  part={part}
                  isActive={index === activeStepIndex}
                  shouldReduceMotion={shouldReduceMotion}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
