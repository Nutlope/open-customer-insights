"use client";

import { useState } from "react";
import { Streamdown } from "streamdown";
import { renderSlackEmoji, slackMrkdwnToMarkdown } from "@/lib/emoji/slackEmoji";

function SlackLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 127 127" className={className} aria-hidden="true">
      <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A" />
      <path d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0" />
      <path d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z" fill="#2EB67D" />
      <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E" />
    </svg>
  );
}

export type SlackMention = {
  channelName?: string;
  text: string;
  authorName?: string;
  avatarUrl?: string;
  postedAt: string;
};

// Cleans up raw Slack token artifacts stored before cleanSlackText masked them.
function sanitizeSlackText(text: string): string {
  return text
    .replace(/@U[A-Z0-9]+/g, "@[user]")
    .replace(/!subteam\^[A-Z0-9]+/gi, "@[group]")
    .replace(/<!here>/gi, "@here")
    .replace(/<!channel>/gi, "@channel");
}

function formatMentionDate({ value }: { value: string }): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function authorInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const CLAMP_THRESHOLD = 280;

function prepareSlackText(raw: string): string {
  return slackMrkdwnToMarkdown({ text: renderSlackEmoji({ text: sanitizeSlackText(raw) }) });
}

export function SlackMentionCard({ mention }: { mention: SlackMention }) {
  const [expanded, setExpanded] = useState(false);
  const initials = mention.authorName ? authorInitials(mention.authorName) : "?";
  const isLong = mention.text.length > CLAMP_THRESHOLD;
  const markdown = prepareSlackText(mention.text);

  return (
    <div className="rounded-lg overflow-hidden bg-white shadow-[0_1px_2px_rgb(24_24_27/0.06),0_0_0_1px_rgb(228_228_231)]">
      {/* Slack-brand header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#4A154B]">
        <SlackLogo className="size-3.5 shrink-0" />
        {mention.channelName && (
          <span className="text-[11px] font-semibold text-white/90 tracking-wide">
            #{mention.channelName}
          </span>
        )}
        <span className="ml-auto text-[10px] text-white/50 shrink-0">
          {formatMentionDate({ value: mention.postedAt })}
        </span>
      </div>

      {/* Message body */}
      <div className="flex gap-2.5 px-3 py-2.5 border-l-2 border-[#4A154B]/20">
        {/* Avatar */}
        {mention.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mention.avatarUrl}
            alt={mention.authorName ?? ""}
            className="mt-0.5 size-7 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-[#4A154B]/10 text-[10px] font-bold text-[#4A154B] select-none">
            {initials}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {mention.authorName && (
            <span className="text-xs font-bold text-zinc-900">{mention.authorName}</span>
          )}
          <div className={`slack-message mt-0.5 text-sm text-zinc-700 overflow-hidden ${!expanded && isLong ? "max-h-[5.5rem]" : ""}`}>
            <Streamdown>{markdown}</Streamdown>
          </div>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[11px] font-medium text-[#4A154B]/70 hover:text-[#4A154B] transition"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
