"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HeadphonesIcon,
  Loader2Icon,
  Maximize2Icon,
  PanelRightCloseIcon,
  TicketIcon,
  XIcon,
} from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { CompanyLogo } from "@/components/company-logo";
import { isPlaceholderDomain } from "@/lib/domain/placeholderDomain";

export type SourcePerson = {
  name?: string;
  email?: string;
};

export type SourceDetail = {
  source: "call" | "support";
  title: string;
  companyDomain?: string;
  date?: string;
  people: SourcePerson[];
  internalPeople?: SourcePerson[];
  sections: Array<{ title: string; text: string }>;
  url?: string;
};

export type SourceReference = {
  source: SourceDetail["source"];
  id: string;
  title?: string;
  date?: string;
  companyDomain?: string;
  snippets?: string[];
};

export type HighlightConfig = {
  terms?: string[];
  pattern?: RegExp | null;
};

type SourceDetailModalState = {
  source: SourceDetail;
  highlight?: HighlightConfig;
};
type HighlightNavState = {
  count: number;
  index: number;
};

type SourceDetailModalContextValue = {
  openSourceDetail: ({ source, highlight }: SourceDetailModalState) => void;
};

const SourceDetailModalContext = createContext<SourceDetailModalContextValue | null>(null);

export function useSourceDetailModal(): SourceDetailModalContextValue {
  const context = useContext(SourceDetailModalContext);
  if (!context) {
    throw new Error("useSourceDetailModal must be used inside SourceDetailModalProvider");
  }
  return context;
}

export function SourceDetailModalProvider({ children }: { children: React.ReactNode }) {
  const [modal, setModal] = useState<SourceDetailModalState | null>(null);
  const [highlightNav, setHighlightNav] = useState<HighlightNavState>({ count: 0, index: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightRefs = useRef<HTMLElement[]>([]);

  useEffect(() => {
    if (!modal) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setModal(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modal]);

  useEffect(() => {
    highlightRefs.current = [];
    setHighlightNav({ count: 0, index: 0 });
    if (!modal?.highlight) return;
    const frame = window.requestAnimationFrame(() => {
      const highlights = Array.from(
        scrollRef.current?.querySelectorAll<HTMLElement>("[data-source-highlight='true']") ?? [],
      );
      highlightRefs.current = highlights;
      if (highlights.length === 0) return;
      const transcriptIndex = modal.source.source === "call"
        ? highlights.findIndex((highlight) => highlight.closest("[data-call-transcript='true']"))
        : -1;
      const index = transcriptIndex >= 0 ? transcriptIndex : 0;
      setHighlightNav({ count: highlights.length, index });
      highlights[index]?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [modal]);

  function navigateHighlight({ direction }: { direction: -1 | 1 }) {
    if (highlightRefs.current.length === 0) return;
    setHighlightNav((current) => {
      const count = highlightRefs.current.length;
      const index = (current.index + direction + count) % count;
      highlightRefs.current[index]?.scrollIntoView({ block: "center", behavior: "smooth" });
      return { count, index };
    });
  }

  function handleHighlightScroll() {
    const container = scrollRef.current;
    const highlights = highlightRefs.current;
    if (!container || highlights.length === 0) return;
    const containerTop = container.getBoundingClientRect().top;
    const nextVisible = highlights.findIndex((highlight) => highlight.getBoundingClientRect().top >= containerTop + 12);
    const index = nextVisible >= 0 ? nextVisible : highlights.length - 1;
    setHighlightNav((current) => current.index === index && current.count === highlights.length
      ? current
      : { count: highlights.length, index });
  }

  return (
    <SourceDetailModalContext.Provider
      value={{
        openSourceDetail: ({ source, highlight }) => setModal({ source, highlight }),
      }}
    >
      {children}
      {modal && (
        <div data-source-detail-modal="true" className="pointer-events-none fixed inset-0 z-50 flex justify-end p-2 sm:p-3">
          <button
            type="button"
            aria-label="Close source inspector"
            onClick={() => setModal(null)}
            className="pointer-events-auto absolute inset-0 cursor-default bg-transparent"
          />
          <div
            className="pointer-events-auto relative z-10 flex h-full w-full max-w-[620px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_18px_64px_rgb(24_24_27/0.22),0_0_0_1px_rgb(228_228_231)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${sourceTheme({ source: modal.source.source }).iconClasses}`}>
                  {modal.source.source === "call" ? <HeadphonesIcon className="size-4" /> : <TicketIcon className="size-4" />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      {modal.source.source === "call" ? "Gong call" : "Pylon ticket"}
                    </p>
                    <CompanyBadge companyDomain={modal.source.companyDomain} />
                  </div>
                  <h2 className="mt-1 truncate text-base font-semibold text-zinc-950 sm:text-lg">{modal.source.title}</h2>
                  {modal.source.date && <p className="mt-0.5 text-xs text-zinc-500">{new Date(modal.source.date).toLocaleString()}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {modal.source.url && (
                  <a
                    href={modal.source.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] transition-[opacity,transform] hover:opacity-90 active:scale-[0.96] ${sourceTheme({ source: modal.source.source }).buttonClasses}`}
                  >
                    {originalSourceLabel({ source: modal.source.source })}
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  aria-label="Close source"
                  onClick={() => setModal(null)}
                  className="flex size-9 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.96]"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            </div>
            <div ref={scrollRef} onScroll={handleHighlightScroll} className="min-h-0 overflow-y-auto bg-zinc-50/70">
              <SourceDetailBody source={modal.source} highlight={modal.highlight} />
            </div>
            {highlightNav.count > 0 && (
              <HighlightNavigator
                state={highlightNav}
                onPrevious={() => navigateHighlight({ direction: -1 })}
                onNext={() => navigateHighlight({ direction: 1 })}
              />
            )}
          </div>
        </div>
      )}
    </SourceDetailModalContext.Provider>
  );
}

function HighlightNavigator({
  state,
  onPrevious,
  onNext,
}: {
  state: HighlightNavState;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 flex items-center gap-1 rounded-xl bg-zinc-950/90 p-1 text-white shadow-[0_12px_40px_rgb(24_24_27/0.24)] backdrop-blur">
      <span className="min-w-14 px-2 text-center text-xs font-semibold tabular-nums">
        {state.index + 1} / {state.count}
      </span>
      <button
        type="button"
        aria-label="Previous highlight"
        onClick={onPrevious}
        className="flex size-7 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white"
      >
        <ChevronUpIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Next highlight"
        onClick={onNext}
        className="flex size-7 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white"
      >
        <ChevronDownIcon className="size-4" />
      </button>
    </div>
  );
}

function originalSourceLabel({ source }: { source: SourceDetail["source"] }): string {
  return source === "call" ? "Open in Gong" : "Open in Pylon";
}

function CompanyBadge({ companyDomain }: { companyDomain?: string }) {
  if (!companyDomain || isPlaceholderDomain({ domain: companyDomain })) return null;
  return (
    <Link
      href={`/companies/${encodeURIComponent(companyDomain)}`}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 transition-colors hover:bg-zinc-200 hover:text-zinc-900"
    >
      <CompanyLogo domain={companyDomain} name={companyDomain} size="size-4" rounded="rounded-full" />
      <span className="truncate font-mono">{companyDomain}</span>
    </Link>
  );
}

function highlightPattern({ highlight }: { highlight?: HighlightConfig }): RegExp | null {
  return highlight?.pattern ?? buildHighlightPattern({ terms: highlight?.terms });
}

function sourceTheme({ source }: { source: SourceDetail["source"] }): {
  iconClasses: string;
  buttonClasses: string;
} {
  if (source === "call") {
    return {
      iconClasses: "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100",
      buttonClasses: "bg-indigo-600 text-white",
    };
  }
  return {
    iconClasses: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    buttonClasses: "bg-emerald-600 text-white",
  };
}

function escapeRegExp({ value }: { value: string }): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildHighlightPattern({ terms }: { terms?: string[] }): RegExp | null {
  const escaped = (terms ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((term) => escapeRegExp({ value: term }));
  if (escaped.length === 0) return null;
  return new RegExp(`(${escaped.join("|")})`, "gi");
}

export function HighlightedText({
  text,
  highlight,
}: {
  text: string;
  highlight?: HighlightConfig;
}) {
  const pattern = useMemo(
    () => highlightPattern({ highlight }),
    [highlight?.pattern, highlight?.terms],
  );
  if (!pattern) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <mark key={`${match.index}-${match[0]}`} className="rounded-md bg-amber-100 px-1 font-semibold text-amber-900 ring-1 ring-amber-200/70">
        <span data-source-highlight="true" className="scroll-mt-24" />
        {match[0]}
      </mark>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function parseMetadata({ text }: { text: string }): Array<{ label: string; value: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...rest] = line.split(":");
      return { label: label?.trim() ?? "", value: rest.join(":").trim() };
    })
    .filter((item) => item.label && item.value);
}

function parseConversation({ text }: { text: string }): Array<{ speaker: string; body: string }> {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const match = block.match(/^([^:]{2,80}):\s*([\s\S]*)$/);
      if (!match) return { speaker: "Message", body: block };
      return { speaker: match[1]!.trim(), body: match[2]!.trim() };
    })
    .filter((message) => message.body.length > 0);
}

function normalizeSpeakerName({ value }: { value?: string }): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function speakerNameParts({ value }: { value?: string }): string[] {
  return normalizeSpeakerName({ value })
    .split(/\s+/)
    .filter((part) => part.length >= 3);
}

function matchesSpeakerName({
  speakerName,
  person,
}: {
  speakerName: string;
  person: SourcePerson;
}): boolean {
  const normalizedSpeaker = normalizeSpeakerName({ value: speakerName });
  const normalizedName = normalizeSpeakerName({ value: person.name });
  if (normalizedName.length >= 3 && (
    normalizedSpeaker.includes(normalizedName) ||
    normalizedName.includes(normalizedSpeaker)
  )) {
    return true;
  }

  const nameParts = speakerNameParts({ value: person.name });
  if (nameParts.length >= 2 && nameParts.every((part) => normalizedSpeaker.includes(part))) {
    return true;
  }

  const emailParts = speakerNameParts({ value: person.email?.split("@")[0] });
  if (emailParts.length >= 2 && emailParts.every((part) => normalizedSpeaker.includes(part))) {
    return true;
  }
  if (emailParts.length === 1 && normalizedSpeaker === emailParts[0]) {
    return true;
  }

  return false;
}

function isInternalStaff({
  speakerName,
  people,
  internalPeople = [],
}: {
  speakerName: string;
  people: SourcePerson[];
  internalPeople?: SourcePerson[];
}): boolean {
  const lowerSpeaker = speakerName.toLowerCase();
  const allPeople = [...internalPeople, ...people];
  for (const person of allPeople) {
    const isInternal = internalPeople.includes(person);
    const matchesPerson = matchesSpeakerName({ speakerName: lowerSpeaker, person });
    if (isInternal && matchesPerson) return true;
  }
  return false;
}

function isKnownExternalSpeaker({
  speakerName,
  people,
}: {
  speakerName: string;
  people: SourcePerson[];
}): boolean {
  return people.some((person) => matchesSpeakerName({ speakerName, person }));
}

const BRIEF_LIMIT = 180;

function CallBrief({ text, highlight }: { text: string; highlight?: HighlightConfig }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > BRIEF_LIMIT;
  const shown = expanded || !isLong ? text : `${text.slice(0, BRIEF_LIMIT).trimEnd()}...`;
  return (
    <section className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Summary</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-700">
        <HighlightedText text={shown} highlight={highlight} />
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 text-xs font-medium text-zinc-400 hover:text-zinc-600"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </section>
  );
}

const KEY_POINTS_LIMIT = 2;

function CallKeyPoints({ text, highlight }: { text: string; highlight?: HighlightConfig }) {
  const [expanded, setExpanded] = useState(false);
  const points = text.split("\n").map((point) => point.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  const shown = expanded ? points : points.slice(0, KEY_POINTS_LIMIT);
  const extra = points.length - KEY_POINTS_LIMIT;
  return (
    <section className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Key points</h3>
      <ul className="mt-2 space-y-2">
        {shown.map((point) => (
          <li key={point} className="flex items-start gap-2.5 text-sm text-zinc-700">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-zinc-300" />
            <span className="leading-6"><HighlightedText text={point} highlight={highlight} /></span>
          </li>
        ))}
      </ul>
      {extra > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-xs font-medium text-zinc-400 hover:text-zinc-600"
        >
          {expanded ? "Show less" : `${extra} more`}
        </button>
      )}
    </section>
  );
}

function PeopleList({ people }: { people: SourcePerson[] }) {
  if (people.length === 0) return null;
  return (
    <section className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">People</h3>
      <div className="mt-2 space-y-1.5">
        {people.map((person) => (
          <div key={`${person.email ?? person.name}`} className="min-w-0 rounded-lg bg-zinc-50 px-2.5 py-2">
            <p className="truncate text-sm font-medium text-zinc-700">{person.name ?? person.email}</p>
            {person.name && person.email && <p className="truncate text-xs text-zinc-400">{person.email}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptySourceSection({ label }: { label: string }) {
  return (
    <section className="flex min-h-40 items-center justify-center rounded-xl bg-white p-6 text-center shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
      <p className="text-sm font-medium text-zinc-400">{label}</p>
    </section>
  );
}

type TranscriptMessage = {
  speaker: string;
  text: string;
  together: boolean;
};

function transcriptSpeakers({ title }: { title: string }): string[] {
  return title === "Transcript" ? [] : title.split(",").map((speaker) => speaker.trim()).filter(Boolean);
}

function splitTranscriptText({
  title,
  text,
}: {
  title: string;
  text: string;
}): Array<{ speaker: string; text: string }> {
  const fallbackSpeaker = transcriptSpeakers({ title })[0] ?? "Speaker";
  const messages: Array<{ speaker: string; text: string }> = [];
  let currentSpeaker = fallbackSpeaker;
  let currentLines: string[] = [];

  function pushCurrent() {
    const body = currentLines.join("\n").trim();
    if (body) messages.push({ speaker: currentSpeaker, text: body });
    currentLines = [];
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentLines.length > 0) currentLines.push("");
      continue;
    }
    const speakerMatch = trimmed.match(/^([^:\n]{2,80}):\s+(.+)$/);
    if (speakerMatch) {
      const nextSpeaker = speakerMatch[1]!.trim();
      const nextText = speakerMatch[2]!.trim();
      if (nextSpeaker !== currentSpeaker) {
        pushCurrent();
        currentSpeaker = nextSpeaker;
      }
      currentLines.push(nextText);
      continue;
    }
    currentLines.push(trimmed);
  }
  pushCurrent();
  return messages;
}

function transcriptMessages({
  sections,
  people,
  internalPeople,
}: {
  sections: SourceDetail["sections"];
  people: SourcePerson[];
  internalPeople?: SourcePerson[];
}): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const section of sections) {
    for (const part of splitTranscriptText({ title: section.title, text: section.text })) {
      const previous = messages.at(-1);
      const together = isInternalStaff({ speakerName: part.speaker, people, internalPeople }) ||
        (people.length > 0 && part.speaker !== "Speaker" && !isKnownExternalSpeaker({ speakerName: part.speaker, people }));
      if (previous && previous.speaker === part.speaker) {
        previous.text = `${previous.text}\n\n${part.text}`;
      } else {
        messages.push({ speaker: part.speaker, text: part.text, together });
      }
    }
  }
  return messages;
}

function TranscriptBubble({
  message,
  highlight,
}: {
  message: TranscriptMessage;
  highlight?: HighlightConfig;
}) {
  return (
    <article className={`flex ${message.together ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[82%] flex-col gap-0.5 ${message.together ? "items-end" : "items-start"}`}>
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-zinc-400">
          {message.speaker}
          {message.together && (
            <span className="rounded bg-indigo-50 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-indigo-400">
              Together
            </span>
          )}
        </div>
        <div
          className={`wrap-break-word rounded-2xl px-3 py-2 text-sm leading-5 ${
            message.together
              ? "rounded-tr-sm bg-zinc-800 text-white"
              : "rounded-tl-sm bg-white text-zinc-800 shadow-[0_0_0_1px_rgb(228_228_231)]"
          }`}
        >
          <HighlightedText text={message.text} highlight={highlight} />
        </div>
      </div>
    </article>
  );
}

function CallSourceBody({
  source,
  highlight,
}: {
  source: SourceDetail;
  highlight?: HighlightConfig;
}) {
  const brief = source.sections.find((section) => section.title === "Brief");
  const keyPoints = source.sections.find((section) => section.title === "Key points");
  const transcriptSections = source.sections.filter((section) => section.title !== "Brief" && section.title !== "Key points");
  const messages = transcriptMessages({
    sections: transcriptSections,
    people: source.people,
    internalPeople: source.internalPeople,
  });

  return (
    <div className="space-y-3 p-3">
      <div className="space-y-2.5">
        {brief ? <CallBrief text={brief.text} highlight={highlight} /> : null}
        {keyPoints ? <CallKeyPoints text={keyPoints.text} highlight={highlight} /> : null}
      </div>
      <section
        className="min-w-0 rounded-xl bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]"
        data-call-transcript="true"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Transcript</h3>
        <div className="mt-3 flex flex-col gap-1.5">
          {messages.length === 0 ? (
            <EmptySourceSection label="No transcript chunks available for this call." />
          ) : (
            messages.map((message, index) => (
              <TranscriptBubble
                key={`${message.speaker}-${index}`}
                message={message}
                highlight={highlight}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function TicketSourceBody({
  source,
  highlight,
}: {
  source: SourceDetail;
  highlight?: HighlightConfig;
}) {
  const metadata = source.sections.filter((section) => section.title !== "Conversation");
  const conversation = source.sections.find((section) => section.title === "Conversation");

  return (
    <div className="space-y-3 p-3">
      <div className="space-y-2">
        {metadata.map((section, index) => (
          <SourceSection
            key={`${section.title}-${index}`}
            sourceType={source.source}
            title={section.title}
            text={section.text}
            people={source.people}
            internalPeople={source.internalPeople}
            highlight={highlight}
          />
        ))}
        <PeopleList people={source.people} />
      </div>
      <section className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Conversation</h3>
        </div>
        {conversation ? (
          <SourceSection
            sourceType={source.source}
            title={conversation.title}
            text={conversation.text}
            people={source.people}
            internalPeople={source.internalPeople}
            highlight={highlight}
          />
        ) : (
          <EmptySourceSection label="No conversation text available for this ticket." />
        )}
      </section>
    </div>
  );
}

export function SourceSection({
  sourceType,
  title,
  text,
  people = [],
  internalPeople = [],
  highlight,
}: {
  sourceType: SourceDetail["source"];
  title: string;
  text: string;
  people?: SourcePerson[];
  internalPeople?: SourcePerson[];
  highlight?: HighlightConfig;
}) {
  if (title === "Matched excerpts") {
    return (
      <section className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
        <div className="mt-2 space-y-2">
          {text.split(/\n{2,}/).map((excerpt, index) => (
            <p key={`${index}-${excerpt.slice(0, 20)}`} className="wrap-break-word text-sm leading-6 text-zinc-700">
              <HighlightedText text={excerpt} highlight={highlight} />
            </p>
          ))}
        </div>
      </section>
    );
  }

  if (title === "Ticket metadata") {
    const items = parseMetadata({ text }).filter(
      (item) => {
        const label = item.label.toLowerCase();
        if (label === "state" && item.value.toLowerCase() === "closed") return false;
        return true;
      },
    );
    return (
      <section className="min-w-0 rounded-lg bg-white p-2.5 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
        <h3 className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
        <dl className="mt-1.5 grid gap-1 sm:grid-cols-3">
          {items.map((item) => (
            <div
              key={`${item.label}:${item.value}`}
              title={`${item.label}: ${item.value}`}
              className="grid min-h-6 min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 text-xs"
            >
              <dt className="min-w-0 truncate font-medium text-zinc-400">{item.label}</dt>
              <dd className="min-w-0 truncate font-semibold text-zinc-700">
                <HighlightedText text={item.value} highlight={highlight} />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  if (sourceType === "support" && title === "Conversation") {
    const messages = parseConversation({ text });
    const hasInternalDirectoryMatches = internalPeople.length > 0;
    const speakerSideCache = new Map<string, boolean>();
    const getSide = ({ speaker }: { speaker: string }): boolean => {
      if (!speakerSideCache.has(speaker)) {
        if (hasInternalDirectoryMatches) {
          speakerSideCache.set(speaker, isInternalStaff({ speakerName: speaker, people, internalPeople }));
        } else {
          speakerSideCache.set(speaker, false);
        }
      }
      return speakerSideCache.get(speaker)!;
    };

    return (
      <section className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Conversation</h3>
        <div className="mt-3 flex flex-col gap-1.5">
          {messages.map((message, index) => {
            const isRight = getSide({ speaker: message.speaker });
            const prevSpeaker = index > 0 ? messages[index - 1]!.speaker : null;
            const showSpeaker = message.speaker !== prevSpeaker;
            return (
              <div key={`${message.speaker}-${index}`} className={`flex ${isRight ? "justify-end" : "justify-start"}`}>
                <div className={`flex max-w-[82%] flex-col gap-0.5 ${isRight ? "items-end" : "items-start"}`}>
                  {showSpeaker && (
                    <span className="flex items-center gap-1.5 px-1 text-[10px] font-medium text-zinc-400">
                      {message.speaker}
                      {isRight && (
                        <span className="rounded bg-indigo-50 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-indigo-400">
                          Together
                        </span>
                      )}
                    </span>
                  )}
                  <div className={`wrap-break-word rounded-2xl px-3 py-2 text-sm leading-5 ${
                    isRight
                      ? "rounded-tr-sm bg-zinc-800 text-white"
                      : "rounded-tl-sm bg-white text-zinc-800 shadow-[0_0_0_1px_rgb(228_228_231)]"
                  }`}>
                    <HighlightedText text={message.body} highlight={highlight} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  if (title === "Brief") return <CallBrief text={text} highlight={highlight} />;
  if (title === "Key points") return <CallKeyPoints text={text} highlight={highlight} />;
  if (sourceType === "call") return null;

  return (
    <section className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
      <MessageResponse className="mt-2 wrap-break-word text-sm leading-6 text-zinc-700">
        {text}
      </MessageResponse>
    </section>
  );
}

export function SourceDetailBody({
  source,
  highlight,
}: {
  source: SourceDetail;
  highlight?: HighlightConfig;
}) {
  if (source.source === "call") return <CallSourceBody source={source} highlight={highlight} />;
  if (source.source === "support") return <TicketSourceBody source={source} highlight={highlight} />;

  return (
    <div className="space-y-3 p-4">
      {source.sections.map((section, index) => (
        <SourceSection
          key={`${section.title}-${index}`}
          sourceType={source.source}
          title={section.title}
          text={section.text}
          people={source.people}
          internalPeople={source.internalPeople}
          highlight={highlight}
        />
      ))}
    </div>
  );
}

export function SourceDetailCard({
  source,
  highlight,
  onClose,
  className = "",
}: {
  source: SourceDetail;
  highlight?: HighlightConfig;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgb(228_228_231),0_1px_2px_rgb(24_24_27/0.04)] ${className}`}>
      <div className="border-b border-zinc-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {source.source === "call" ? "Call source" : "Ticket source"}
              </p>
              <CompanyBadge companyDomain={source.companyDomain} />
            </div>
            <h2 className="mt-1 text-balance text-lg font-semibold leading-6 tracking-tight text-zinc-950">{source.title}</h2>
            {source.date && <p className="mt-1 text-xs text-zinc-500">{new Date(source.date).toLocaleString()}</p>}
          </div>
          {onClose && (
            <button
              type="button"
              aria-label="Close source panel"
              onClick={onClose}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.96]"
            >
              <PanelRightCloseIcon className="size-4" />
            </button>
          )}
        </div>
        {source.people.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">People</p>
            {source.people.map((person) => (
              <p key={`${person.email ?? person.name}`} className="truncate text-sm text-zinc-600">
                {person.name ?? person.email}{person.name && person.email ? ` . ${person.email}` : ""}
              </p>
            ))}
          </div>
        )}
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={`mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-[opacity,transform] hover:opacity-90 active:scale-[0.96] ${sourceTheme({ source: source.source }).buttonClasses}`}
          >
            {originalSourceLabel({ source: source.source })}
            <ExternalLinkIcon className="size-3.5" />
          </a>
        )}
      </div>
      <SourceDetailBody source={source} highlight={highlight} />
    </div>
  );
}

function SourceTypeIcon({ source }: { source: SourceReference["source"] }) {
  if (source === "call") return <HeadphonesIcon className="size-3.5" />;
  return <TicketIcon className="size-3.5" />;
}

function sourceReferenceTheme({ source }: { source: SourceReference["source"] }): {
  chipClasses: string;
  iconClasses: string;
  label: string;
} {
  if (source === "call") {
    return {
      chipClasses: "bg-indigo-50 text-indigo-700 ring-indigo-100",
      iconClasses: "bg-indigo-50 text-indigo-600 ring-indigo-100",
      label: "Gong call",
    };
  }
  return {
    chipClasses: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    iconClasses: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    label: "Pylon ticket",
  };
}

function cleanSourceId({ id }: { id: string }) {
  return id
    .replace(/^(?:(?:call|support):)+/, "")
    .split("|")[0]!
    .trim();
}

function formatSourceDate({ value }: { value?: string }): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SourceViewer({
  reference,
  highlight,
  loadSource,
  mode = "inline",
  onSourceLoaded,
  className = "",
}: {
  reference: SourceReference;
  highlight?: HighlightConfig;
  loadSource?: ({ reference }: { reference: SourceReference }) => Promise<SourceDetail | null>;
  mode?: "button" | "inline";
  onSourceLoaded?: ({ source }: { source: SourceDetail }) => void;
  className?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [sourceDetail, setSourceDetail] = useState<SourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { openSourceDetail } = useSourceDetailModal();
  const cleanId = cleanSourceId({ id: reference.id });
  const sourceDate = formatSourceDate({ value: reference.date });
  const title = reference.title ?? cleanId;
  const theme = sourceReferenceTheme({ source: reference.source });

  async function fetchSource() {
    if (!loadSource) return null;
    if (sourceDetail) return sourceDetail;
    setIsLoading(true);
    setError(null);
    try {
      const detail = await loadSource({ reference });
      setSourceDetail(detail);
      if (detail) onSourceLoaded?.({ source: detail });
      if (!detail) setError("Could not load this source.");
      return detail;
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not load this source.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenSource() {
    const detail = await fetchSource();
    if (detail) openSourceDetail({ source: detail, highlight });
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!loadSource) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void handleOpenSource();
  }

  if (mode === "button") {
    return (
      <button
        type="button"
        onClick={handleOpenSource}
        className={`flex min-w-0 items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-left shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)] transition-[box-shadow,transform] hover:shadow-[0_2px_8px_rgb(24_24_27/0.08),0_0_0_1px_rgb(212_212_216)] active:scale-[0.96] ${className}`}
      >
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ${theme.iconClasses}`}>
          {isLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : <SourceTypeIcon source={reference.source} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-zinc-950">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">
            {isLoading ? "Loading..." : `${theme.label} · ${cleanId}`}
          </span>
        </span>
        <Maximize2Icon className="size-3.5 shrink-0 text-zinc-300" />
      </button>
    );
  }

  return (
    <div
      role={loadSource ? "button" : undefined}
      tabIndex={loadSource ? 0 : undefined}
      onClick={loadSource ? () => void handleOpenSource() : undefined}
      onKeyDown={handleCardKeyDown}
      className={`rounded-lg bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)] transition-[box-shadow,transform] ${
        loadSource ? "cursor-pointer hover:shadow-[0_2px_8px_rgb(24_24_27/0.08),0_0_0_1px_rgb(212_212_216)] active:scale-[0.96]" : ""
      } ${className}`}
    >
      <div className="flex min-w-0 items-start gap-2 text-xs text-zinc-500">
        <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ${theme.iconClasses}`}>
          {isLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : <SourceTypeIcon source={reference.source} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-zinc-700">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${theme.chipClasses}`}>{theme.label}</span>
            {sourceDate && <span>{sourceDate}</span>}
            {reference.companyDomain && !isPlaceholderDomain({ domain: reference.companyDomain }) ? (
              <Link
                href={`/companies/${encodeURIComponent(reference.companyDomain)}`}
                onClick={(e) => e.stopPropagation()}
                className="font-mono hover:text-zinc-700 hover:underline underline-offset-2"
              >
                {reference.companyDomain}
              </Link>
            ) : (
              reference.companyDomain && <span className="font-mono">{reference.companyDomain}</span>
            )}
          </div>
        </div>
        {loadSource && <Maximize2Icon className="mt-1 size-3.5 shrink-0 text-zinc-300" />}
      </div>
      {reference.snippets && reference.snippets.length > 0 && (
        <div className="mt-2">
          <SourceSection
            sourceType={reference.source}
            title="Matched excerpts"
            text={reference.snippets.join("\n\n")}
            highlight={highlight}
            internalPeople={sourceDetail?.internalPeople}
          />
        </div>
      )}
      {error && <p className="mt-2 text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}

export function SourceDetailPanel({
  source,
  onClose,
  highlight,
}: {
  source: SourceDetail | null;
  onClose: () => void;
  highlight?: HighlightConfig;
}) {
  return (
    <aside className="hidden min-w-0 overflow-x-clip lg:block">
      <div className="sticky top-[117px] max-h-[calc(100vh-133px)] overflow-x-hidden overflow-y-auto rounded-lg bg-white shadow-[0_0_0_1px_rgb(228_228_231),0_1px_2px_rgb(24_24_27/0.04)]">
        {!source ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 p-6 text-center">
            <FileTextIcon className="size-5 text-zinc-300" />
            <p className="text-sm font-medium text-zinc-500">Select a call or ticket to inspect the source.</p>
          </div>
        ) : (
          <SourceDetailCard source={source} highlight={highlight} onClose={onClose} className="rounded-none shadow-none" />
        )}
      </div>
    </aside>
  );
}
