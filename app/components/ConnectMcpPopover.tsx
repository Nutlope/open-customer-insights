"use client";

import { CheckIcon, ChevronDownIcon, CopyIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MCP_SERVER_NAME } from "@/lib/constants";

interface Props {
  mcpUrl: string;
}

interface PromptAnswer {
  prompt: string;
  answer: string;
  copyable?: boolean;
}

const MCP_DISPLAY_NAME = "Together Customer Insights MCP";

export default function ConnectMcpPopover({ mcpUrl }: Props) {
  const addCommand = "opencode mcp add";
  const authCommand = `opencode mcp auth ${MCP_SERVER_NAME}`;
  const answers: PromptAnswer[] = [
    { prompt: "Location", answer: "Global" },
    { prompt: "MCP server name", answer: MCP_SERVER_NAME, copyable: true },
    { prompt: "MCP server type", answer: "Remote" },
    { prompt: "MCP server URL", answer: mcpUrl, copyable: true },
    { prompt: "Requires OAuth?", answer: "Yes" },
    { prompt: "Pre-registered client ID?", answer: "No" },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-zinc-700 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-950 active:scale-[0.96]">
          <OpencodeLogo className="size-4 rounded-[3px]" />
          <span className="hidden sm:inline">Install MCP</span>
          <ChevronDownIcon className="size-3 opacity-45" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-zinc-200 bg-white p-0 shadow-[0_24px_70px_rgba(24,24,27,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4 pb-3 pt-4">
          <OpencodeLogo className="size-7 shrink-0 rounded-md" />
          <div>
            <p className="text-[13px] font-semibold leading-tight text-zinc-950">Add to opencode</p>
            <p className="text-[11px] leading-tight text-zinc-400">{MCP_DISPLAY_NAME}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <CommandStep
            title="1 · Start the guided setup"
            command={addCommand}
          />

          <section>
            <StepTitle>2 · Answer the prompts</StepTitle>
            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <div className="grid grid-cols-[1fr_1.25fr] border-b border-zinc-200 bg-zinc-50">
                <span className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Prompt
                </span>
                <span className="border-l border-zinc-200 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  Answer
                </span>
              </div>
              <div className="grid grid-cols-[1fr_1.25fr] text-[11px] leading-snug">
                {answers.map((item, index) => (
                  <PromptAnswerRow
                    key={item.prompt}
                    item={item}
                    isLast={index === answers.length - 1}
                  />
                ))}
              </div>
            </div>
          </section>

          <CommandStep
            title="3 · Authenticate via OAuth"
            command={authCommand}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandStep({ title, command }: { title: string; command: string }) {
  return (
    <section>
      <StepTitle>{title}</StepTitle>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-950 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <code className="min-w-0 break-all font-mono text-[11px] text-zinc-200">
          {command}
        </code>
        <CopyButton text={command} variant="dark" />
      </div>
    </section>
  );
}

function PromptAnswerRow({
  item,
  isLast,
}: {
  item: PromptAnswer;
  isLast: boolean;
}) {
  const borderClass = isLast ? "" : "border-b border-zinc-100";

  return (
    <>
      <div className={`px-3 py-2 text-zinc-500 ${borderClass}`}>
        {item.prompt}
      </div>
      <div
        className={`flex min-w-0 items-center justify-between gap-2 border-l border-zinc-100 bg-white px-3 py-2 ${borderClass}`}
      >
        <code className="min-w-0 break-all font-mono text-zinc-900">
          {item.answer}
        </code>
        {item.copyable && <CopyButton text={item.answer} variant="light" />}
      </div>
    </>
  );
}

function StepTitle({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
      {children}
    </p>
  );
}

function CopyButton({
  text,
  variant,
}: {
  text: string;
  variant: "dark" | "light";
}) {
  const [copied, setCopied] = useState(false);
  const isDark = variant === "dark";

  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        isDark
          ? "flex min-h-7 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition-[background-color,color,transform] hover:bg-white/10 hover:text-white active:scale-[0.96]"
          : "flex min-h-7 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.96]"
      }
    >
      {copied ? (
        <>
          <CheckIcon className="size-3 text-emerald-500" />
          <span className="text-emerald-500">Copied</span>
        </>
      ) : (
        <>
          <CopyIcon className="size-3" />
          Copy
        </>
      )}
    </button>
  );
}

function OpencodeLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
    >
      <rect width="512" height="512" fill="#131010" rx="80" />
      <path d="M320 224V352H192V224H320Z" fill="#5A5858" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
        fill="white"
      />
    </svg>
  );
}
