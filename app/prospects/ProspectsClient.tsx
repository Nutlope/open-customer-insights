"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import {
  Building2Icon,
  CalendarClockIcon,
  ChevronDownIcon,
  CheckIcon,
  FileTextIcon,
  HeadphonesIcon,
  InfoIcon,
  MessageSquareIcon,
  PauseCircleIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  SwordsIcon,
  TicketIcon,
  Trash2Icon,
  TrophyIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { HealthChip } from "@/components/health-chip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  SourceViewer,
  type SourceDetail,
  type SourceReference,
} from "@/components/source-detail-renderer";
import { SourceIcon } from "@/app/components/sourceVisuals";
import { SlackMentionCard } from "@/components/slack-mention-card";

type Membership = Doc<"companySegmentMemberships"> & {
  company: ProspectCompany | null;
};
type ProspectSlackChannel = {
  id: string;
  name: string;
};
type ProspectCompany = Doc<"companyProfiles"> & {
  slackChannel?: ProspectSlackChannel | null;
};
type SegmentDashboard = Doc<"companySegments"> & {
  memberships: Membership[];
  latestRun: Doc<"companySegmentRuns"> | null;
};
type EditableSegment = {
  segmentId?: Id<"companySegments">;
  title: string;
  description: string;
  detectionPrompt: string;
};
type ProspectAccount = {
  key: string;
  company: ProspectCompany | null;
  memberships: Array<Membership & { segment: SegmentDashboard }>;
  primary: Membership & { segment: SegmentDashboard };
  lastSeenAt: number;
  firstSeenAt: number;
  fitScore: number;
  evidenceCount: number;
};
type ProspectBrief = {
  dateText: string;
  scale: string;
  currentStack: string;
  intent: string;
  keyEvidence: string | null;
  nextAction: string | null;
  extraDetails: string[];
};
type CompanyOption = {
  companyId?: Id<"companyProfiles">;
  name: string;
  domain: string;
  status: Doc<"companyProfiles">["status"];
  sources: Doc<"companyProfiles">["sources"];
  size?: string;
  callCount: number;
  ticketCount: number;
  alreadyProvisionedThroughputProspect: boolean;
};
type SlackEvidenceReference = {
  source: "slack";
  id: string;
  title?: string;
  date?: string;
  channelId?: string;
  channelName?: string;
  text: string;
  authorName?: string;
  authorAvatar?: string;
};
type EvidenceTimelineItem = (SourceReference | SlackEvidenceReference) & {
  snippet?: string;
  time: number;
  pinned: boolean;
};
type ProspectEvidenceOption = {
  source: "call" | "support" | "slack";
  id: string;
  title?: string;
  date?: string;
  snippet: string;
  alreadyPinned: boolean;
  slack?: {
    channelId: string;
    channelName?: string;
    messageTs: string;
    threadTs?: string;
    authorName?: string;
    authorAvatar?: string;
  };
};
type EvidenceSourceFilter = "all" | "call" | "support" | "slack";
type SortMode = "recent" | "priority";
type ProspectOutcome = "active" | "lost" | "won" | "stalled";
type OutcomeFilter = "all" | "open" | "lost" | "won";
type OutcomeFormState = {
  outcome: ProspectOutcome;
  lostToCompetitor: string;
  lostReason: string;
  competitorsConsidered: string;
};

const OUTCOME_OPTIONS: Array<{ value: ProspectOutcome; label: string }> = [
  { value: "active", label: "Active" },
  { value: "lost", label: "Lost" },
  { value: "won", label: "Won" },
  { value: "stalled", label: "Stalled" },
];

const COMPANY_NAME_OVERRIDES: Record<string, string> = {
  "bluedrop.ai": "BlueDrop",
  "darlink.ai": "DarLink",
  "distinctpatentlaw.com": "Distinct Patent Law",
  "ehealth.com": "eHealth",
  "enrollhere.com": "EnrollHere",
  "resumeworded.com": "Resume Worded",
  "semianalysis.com": "SemiAnalysis",
};

function formatShortDate({ timestamp }: { timestamp?: number }): string {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function formatIsoDate({ value }: { value?: string }): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return formatShortDate({ timestamp: time });
}

function daysSince({ timestamp }: { timestamp?: number }): number | null {
  if (!timestamp) return null;
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

function relativeAge({ timestamp }: { timestamp?: number }): string {
  const days = daysSince({ timestamp });
  if (days === null) return "unknown";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function fullDateLabel({ value }: { value?: string }): string {
  if (!value) return "Unknown date";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(time));
}

function faviconUrl({ domain }: { domain?: string }): string | null {
  if (!domain || domain.endsWith(".unknown")) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function cleanDomainInput({ value }: { value: string }): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0] ?? "";
}

function displayCompanyName({ company }: { company: Doc<"companyProfiles"> | null }): string {
  if (!company) return "Unknown company";
  return COMPANY_NAME_OVERRIDES[company.domain] ?? company.name;
}

function segmentToEditable({ segment }: { segment: Doc<"companySegments"> }): EditableSegment {
  return {
    segmentId: segment._id,
    title: segment.title,
    description: segment.description,
    detectionPrompt: segment.detectionPrompt,
  };
}

function urgencyForAccount({ account }: { account: ProspectAccount }): {
  label: string;
  classes: string;
  dot: string;
} {
  const lastSeenDays = daysSince({ timestamp: account.lastSeenAt });
  if (account.fitScore >= 90 || (lastSeenDays !== null && lastSeenDays <= 14)) {
    return {
      label: "Hot",
      classes: "bg-rose-50 text-rose-700 ring-rose-200",
      dot: "bg-rose-500",
    };
  }
  if (account.fitScore >= 80 || (lastSeenDays !== null && lastSeenDays <= 45)) {
    return {
      label: "Warm",
      classes: "bg-amber-50 text-amber-800 ring-amber-200",
      dot: "bg-amber-500",
    };
  }
  return {
    label: "Watch",
    classes: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  };
}

function confidenceClasses({ confidence }: { confidence: Membership["confidence"] }): string {
  if (confidence === "high") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (confidence === "medium") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-zinc-100 text-zinc-500 ring-zinc-200";
}

function outcomeOf({ membership }: { membership: Membership }): ProspectOutcome {
  return membership.outcome ?? "active";
}

function statusBadgeForAccount({ account }: { account: ProspectAccount }): {
  label: string;
  classes: string;
  dot?: string;
  Icon?: typeof TrophyIcon;
} {
  const outcome = outcomeOf({ membership: account.primary });
  if (outcome === "lost") {
    const competitor = account.primary.lostToCompetitor;
    return {
      label: competitor ? `Lost → ${competitor}` : "Lost",
      classes: "bg-rose-100 text-rose-800 ring-rose-200",
      Icon: XCircleIcon,
    };
  }
  if (outcome === "won") {
    return {
      label: "Won",
      classes: "bg-emerald-100 text-emerald-800 ring-emerald-200",
      Icon: TrophyIcon,
    };
  }
  if (outcome === "stalled") {
    return {
      label: "Stalled",
      classes: "bg-amber-100 text-amber-900 ring-amber-200",
      Icon: PauseCircleIcon,
    };
  }
  return urgencyForAccount({ account });
}

function rowClassesForAccount({
  outcome,
  selected,
}: {
  outcome: ProspectOutcome;
  selected: boolean;
}): string {
  if (selected) {
    if (outcome === "lost") return "bg-rose-50 shadow-[inset_3px_0_0_0_#e11d48]";
    if (outcome === "won") return "bg-emerald-50 shadow-[inset_3px_0_0_0_#059669]";
    if (outcome === "stalled") return "bg-amber-50 shadow-[inset_3px_0_0_0_#d97706]";
    return "bg-zinc-50 shadow-[inset_3px_0_0_0_#18181b]";
  }
  if (outcome === "lost") return "bg-rose-50/55 hover:bg-rose-50";
  if (outcome === "won") return "bg-emerald-50/55 hover:bg-emerald-50";
  if (outcome === "stalled") return "bg-amber-50/55 hover:bg-amber-50";
  return "hover:bg-zinc-50";
}

function outcomeFilterClasses({
  filter,
  selected,
}: {
  filter: OutcomeFilter;
  selected: boolean;
}): string {
  // Mirror the table's status badge colors for Lost/Won so the filter tabs
  // read as the same category.
  if (filter === "lost") {
    return selected
      ? "bg-rose-100 text-rose-800 ring-1 ring-rose-200"
      : "text-rose-600 hover:bg-rose-50 hover:text-rose-700";
  }
  if (filter === "won") {
    return selected
      ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200"
      : "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700";
  }
  if (selected) return "bg-white text-zinc-950 shadow-[0_1px_2px_rgba(24,24,27,0.08),0_0_0_1px_rgba(24,24,27,0.06)]";
  return "text-zinc-600 hover:bg-white/70 hover:text-zinc-950";
}

function outcomeFilterDotClasses({ filter }: { filter: OutcomeFilter }): string {
  if (filter === "open") return "bg-zinc-900";
  return "bg-zinc-400";
}

function outcomeFilterIcon({ filter }: { filter: OutcomeFilter }): typeof TrophyIcon | undefined {
  if (filter === "lost") return XCircleIcon;
  if (filter === "won") return TrophyIcon;
  return undefined;
}

function outcomeFilterCount({
  filter,
  total,
  counts,
}: {
  filter: OutcomeFilter;
  total: number;
  counts: Record<ProspectOutcome, number>;
}): number {
  if (filter === "all") return total;
  if (filter === "open") return counts.active + counts.stalled;
  return counts[filter];
}

function outcomeToFormState({ membership }: { membership: Membership }): OutcomeFormState {
  return {
    outcome: outcomeOf({ membership }),
    lostToCompetitor: membership.lostToCompetitor ?? "",
    lostReason: membership.lostReason ?? "",
    competitorsConsidered: (membership.competitorsConsidered ?? []).join(", "),
  };
}

function SegmentForm({
  value,
  onChange,
  onCancel,
  onSave,
  saving,
}: {
  value: EditableSegment;
  onChange: (value: EditableSegment) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  function setField<Key extends keyof EditableSegment>({ key, next }: { key: Key; next: EditableSegment[Key] }) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Name</span>
          <input
            value={value.title}
            onChange={(event) => setField({ key: "title", next: event.target.value })}
            className="mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition-colors focus:border-zinc-400"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Description</span>
          <input
            value={value.description}
            onChange={(event) => setField({ key: "description", next: event.target.value })}
            className="mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition-colors focus:border-zinc-400"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-zinc-500">Detection prompt</span>
        <textarea
          value={value.detectionPrompt}
          onChange={(event) => setField({ key: "detectionPrompt", next: event.target.value })}
          rows={3}
          className="mt-1 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400"
        />
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition-[background-color,transform] hover:bg-zinc-100 active:scale-[0.96]"
        >
          <XIcon className="size-4" />
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition-[opacity,transform] hover:opacity-90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <SaveIcon className="size-4" />
          Save
        </button>
      </div>
    </div>
  );
}

function buildAccounts({
  segments,
  selectedSegmentId,
}: {
  segments: SegmentDashboard[];
  selectedSegmentId: Id<"companySegments"> | "all";
}): ProspectAccount[] {
  const byCompany = new Map<string, ProspectAccount>();
  const visibleSegments = selectedSegmentId === "all"
    ? segments
    : segments.filter((segment) => segment._id === selectedSegmentId);

  for (const segment of visibleSegments) {
    for (const membership of segment.memberships) {
      const key = membership.company?._id ?? `${segment._id}:${membership._id}`;
      const enriched = { ...membership, segment };
      const existing = byCompany.get(key);
      if (!existing) {
        byCompany.set(key, {
          key,
          company: membership.company,
          memberships: [enriched],
          primary: enriched,
          firstSeenAt: membership.firstSeenAt,
          lastSeenAt: membership.lastSeenAt,
          fitScore: membership.fitScore,
          evidenceCount: membership.evidenceRefs.length,
        });
        continue;
      }
      existing.memberships.push(enriched);
      existing.firstSeenAt = Math.min(existing.firstSeenAt, membership.firstSeenAt);
      existing.lastSeenAt = Math.max(existing.lastSeenAt, membership.lastSeenAt);
      existing.fitScore = Math.max(existing.fitScore, membership.fitScore);
      existing.evidenceCount += membership.evidenceRefs.length;
      if (membership.fitScore > existing.primary.fitScore) existing.primary = enriched;
    }
  }

  return [...byCompany.values()].sort((a, b) => {
    const recencyDelta = b.lastSeenAt - a.lastSeenAt;
    if (recencyDelta !== 0) return recencyDelta;
    return b.fitScore - a.fitScore;
  });
}

function filterAccountsByOutcome({
  accounts,
  outcomeFilter,
}: {
  accounts: ProspectAccount[];
  outcomeFilter: OutcomeFilter;
}): ProspectAccount[] {
  if (outcomeFilter === "all") return accounts;
  if (outcomeFilter === "open") {
    return accounts.filter((account) => {
      const outcome = outcomeOf({ membership: account.primary });
      return outcome === "active" || outcome === "stalled";
    });
  }
  return accounts.filter((account) => outcomeOf({ membership: account.primary }) === outcomeFilter);
}

function visibleAccounts({
  accounts,
  sortMode,
}: {
  accounts: ProspectAccount[];
  sortMode: SortMode;
}): ProspectAccount[] {
  return [...accounts].sort((a, b) => {
    if (sortMode === "priority") {
      const priorityDelta = b.fitScore - a.fitScore;
      if (priorityDelta !== 0) return priorityDelta;
    }
    const recencyDelta = b.lastSeenAt - a.lastSeenAt;
    if (recencyDelta !== 0) return recencyDelta;
    return b.fitScore - a.fitScore;
  });
}

function membershipEvidenceRefs({ membership }: { membership: Membership }): Array<{
  source: "call" | "support" | "slack";
  id: string;
  title?: string;
  date?: string;
  snippet: string;
}> {
  return [
    ...(membership.manualEvidenceRefs ?? []).map((reference) => ({
      source: reference.source,
      id: reference.id,
      title: reference.title,
      date: reference.date,
      snippet: reference.snippet,
    })),
    ...membership.evidenceRefs,
  ];
}

function manualEvidenceKeys({ account }: { account: ProspectAccount }): Set<string> {
  return new Set(account.memberships.flatMap((membership) => (
    (membership.manualEvidenceRefs ?? []).map((reference) => `${reference.source}:${reference.id}`)
  )));
}

type SlackMentionSummary = {
  _id: Id<"slackCompanyMentions">;
  channelId: string;
  channelName?: string;
  text: string;
  resolvedAuthorName?: string;
  avatarUrl?: string;
  postedAt: string;
};

function evidenceTimeline({
  account,
  slackMentions,
}: {
  account: ProspectAccount;
  slackMentions: SlackMentionSummary[] | undefined;
}): EvidenceTimelineItem[] {
  const sources = new Map<string, EvidenceTimelineItem>();
  const pinnedKeys = manualEvidenceKeys({ account });
  const slackById = new Map<string, SlackMentionSummary>();
  for (const mention of slackMentions ?? []) {
    slackById.set(mention._id, mention);
  }
  for (const membership of account.memberships) {
    for (const reference of membershipEvidenceRefs({ membership })) {
      const key = `${reference.source}:${reference.id}`;
      const time = reference.date ? new Date(reference.date).getTime() : 0;
      const snippet = cleanEvidenceText({ text: reference.snippet });
      const existing = sources.get(key);
      if (reference.source === "slack") {
        // Pinned Slack ref — pull display data from slackMentions so the
        // side panel can render the SlackMentionCard. The prospect side panel
        // is a curated view, so non-pinned Slack mentions aren't shown here
        // (admins pin from the company page or the "Pin evidence" modal).
        const mention = slackById.get(reference.id);
        const next: EvidenceTimelineItem = {
          source: "slack",
          id: reference.id,
          title: reference.title ?? `${mention?.resolvedAuthorName ?? "Unknown"} in #${mention?.channelName ?? mention?.channelId ?? ""}`,
          date: reference.date,
          text: mention?.text ?? "",
          authorName: mention?.resolvedAuthorName,
          authorAvatar: mention?.avatarUrl,
          channelId: mention?.channelId,
          channelName: mention?.channelName,
          snippet,
          time: Number.isFinite(time) ? time : 0,
          pinned: pinnedKeys.has(key),
        };
        if (existing && existing.source === "slack") {
          sources.set(key, {
            ...existing,
            time: Math.max(existing.time, next.time),
            snippet: existing.snippet ?? next.snippet,
            text: existing.text || next.text,
            pinned: existing.pinned || next.pinned,
          });
        } else {
          sources.set(key, next);
        }
        continue;
      }
      // call or support — accumulate snippets across memberships
      if (existing && existing.source !== "slack") {
        const snippets = new Set([...(existing.snippets ?? []), snippet].filter(Boolean));
        sources.set(key, {
          ...existing,
          snippets: [...snippets],
          snippet: existing.snippet ?? snippet,
          time: Math.max(existing.time, Number.isFinite(time) ? time : 0),
          pinned: existing.pinned || pinnedKeys.has(key),
        });
        continue;
      }
      sources.set(key, {
        source: reference.source,
        id: reference.id,
        title: reference.title,
        date: reference.date,
        snippets: snippet ? [snippet] : undefined,
        snippet,
        time: Number.isFinite(time) ? time : 0,
        pinned: pinnedKeys.has(key),
      });
    }
  }
  return [...sources.values()].sort((a, b) => b.time - a.time);
}

type SidePanelActivityItem = { id: string; source: "call" | "support"; title: string; date: string; companyDomain?: string };
type SidePanelPinnedItem = { id: string; source: "call" | "support" | "slack"; title: string; date: string; companyDomain?: string; slackText?: string; slackChannelName?: string; slackAuthorName?: string; slackAuthorAvatar?: string };
type SidePanelKeyEvidenceItem = { id: string; source: "call" | "support" | "slack" };

function buildSidePanelTimeline({
  activity,
  slackMentions,
  pinnedActivity,
  keyEvidence,
}: {
  activity: SidePanelActivityItem[] | undefined;
  slackMentions: SlackMentionSummary[] | undefined;
  pinnedActivity: SidePanelPinnedItem[] | undefined;
  keyEvidence: SidePanelKeyEvidenceItem[] | undefined;
}): EvidenceTimelineItem[] {
  const items = new Map<string, EvidenceTimelineItem>();
  const pinnedSet = new Set((keyEvidence ?? []).map((item) => `${item.source}:${item.id}`));

  for (const item of activity ?? []) {
    const key = `${item.source}:${item.id}`;
    const time = new Date(item.date).getTime();
    items.set(key, {
      source: item.source,
      id: item.id,
      title: item.title,
      date: item.date,
      companyDomain: item.companyDomain,
      time: Number.isFinite(time) ? time : 0,
      pinned: pinnedSet.has(key),
    });
  }

  for (const mention of slackMentions ?? []) {
    const key = `slack:${mention._id}`;
    const time = new Date(mention.postedAt).getTime();
    items.set(key, {
      source: "slack",
      id: mention._id,
      title: `${mention.resolvedAuthorName ?? "Unknown"} in #${mention.channelName ?? mention.channelId}`,
      date: mention.postedAt,
      text: mention.text,
      authorName: mention.resolvedAuthorName,
      authorAvatar: mention.avatarUrl,
      channelId: mention.channelId,
      channelName: mention.channelName,
      time: Number.isFinite(time) ? time : 0,
      pinned: pinnedSet.has(key),
    });
  }

  for (const item of pinnedActivity ?? []) {
    const key = `${item.source}:${item.id}`;
    if (items.has(key)) {
      const existing = items.get(key)!;
      items.set(key, { ...existing, pinned: true });
      continue;
    }
    const time = new Date(item.date).getTime();
    if (item.source === "slack") {
      items.set(key, {
        source: "slack",
        id: item.id,
        title: item.title,
        date: item.date,
        text: item.slackText ?? "",
        authorName: item.slackAuthorName,
        authorAvatar: item.slackAuthorAvatar,
        channelName: item.slackChannelName,
        time: Number.isFinite(time) ? time : 0,
        pinned: true,
      });
    } else {
      items.set(key, {
        source: item.source,
        id: item.id,
        title: item.title,
        date: item.date,
        companyDomain: item.companyDomain,
        time: Number.isFinite(time) ? time : 0,
        pinned: true,
      });
    }
  }

  return [...items.values()].sort((a, b) => b.time - a.time);
}

function cleanBriefText({ text, maxLength }: { text?: string | null; maxLength: number }): string {
  const cleaned = (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/^CALL:\s*/i, "")
    .replace(/^ISSUE:\s*/i, "")
    .trim();
  if (cleaned === "-") return "";
  if (!cleaned) return "";
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}...`;
}

function cleanEvidenceText({ text }: { text?: string | null }): string {
  const raw = text ?? "";
  const afterBrief = raw.includes(" Brief: ") ? raw.split(" Brief: ").at(-1) : raw;
  return cleanBriefText({ text: afterBrief, maxLength: 260 });
}

function stripSourceBoilerplate({ text }: { text: string }): string {
  return text
    .replace(/\bSource detail:\s*/gi, " ")
    .replace(/\b(?:CALL|ISSUE):\s*[^.?!|]+/gi, " ")
    .replace(/\bCompany:\s*[^.?!|]+/gi, " ")
    .replace(/\bDomain:\s*[^.?!|]+/gi, " ")
    .replace(/\bState:\s*[^.?!|]+/gi, " ")
    .replace(/\bwaiting_on_customer\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prospectBrief({ account }: { account: ProspectAccount }): ProspectBrief {
  const datedRefs = account.memberships
    .flatMap((membership) => membershipEvidenceRefs({ membership }))
    .filter((ref) => ref.date)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const dateText = [...new Set(datedRefs.map((ref) => formatIsoDate({ value: ref.date })).filter((date): date is string => date !== null))]
    .slice(0, 3)
    .join(" & ") || formatShortDate({ timestamp: account.lastSeenAt });
  const evidence = membershipEvidenceRefs({ membership: account.primary })[0];
  const nextAction = account.primary.nextSteps[0] ? cleanBriefText({ text: account.primary.nextSteps[0], maxLength: 180 }) : null;
  return {
    dateText,
    scale: cleanBriefText({ text: account.primary.scale, maxLength: 150 }),
    currentStack: cleanBriefText({ text: account.primary.currentState ?? evidence?.snippet, maxLength: 190 }),
    intent: cleanBriefText({ text: account.primary.summary, maxLength: 260 }),
    keyEvidence: evidence ? cleanEvidenceText({ text: evidence.snippet }) : null,
    nextAction,
    extraDetails: (account.primary.extraDetails ?? [])
      .map((detail) => cleanBriefText({ text: stripSourceBoilerplate({ text: detail }), maxLength: 220 }))
      .filter(Boolean)
      .slice(0, 6),
  };
}

function EvidenceSource({
  reference,
  loadSource,
}: {
  reference: EvidenceTimelineItem;
  loadSource: ({ reference }: { reference: SourceReference }) => Promise<SourceDetail | null>;
}) {
  if (reference.source === "slack") {
    return (
      <SlackMentionCard
        mention={{
          channelName: reference.channelName,
          text: reference.text,
          authorName: reference.authorName,
          avatarUrl: reference.authorAvatar,
          postedAt: reference.date ?? "",
        }}
      />
    );
  }
  return <SourceViewer reference={reference} loadSource={loadSource} />;
}

function AddProspectDialog({
  search,
  options,
  selectedCompany,
  saving,
  onSearchChange,
  onSelectCompany,
  onClose,
  onSave,
}: {
  search: string;
  options?: CompanyOption[];
  selectedCompany: CompanyOption | null;
  saving: boolean;
  onSearchChange: ({ value }: { value: string }) => void;
  onSelectCompany: ({ company }: { company: CompanyOption }) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const normalizedSearch = cleanDomainInput({ value: search });
  const exactTrackedMatch = options?.find((company) => (
    company.alreadyProvisionedThroughputProspect &&
    (company.domain.toLowerCase() === normalizedSearch || company.name.toLowerCase() === search.trim().toLowerCase())
  ));
  const selectedHasData = selectedCompany ? selectedCompany.callCount + selectedCompany.ticketCount > 0 : false;
  const canSave = selectedCompany !== null && selectedHasData && !selectedCompany.alreadyProvisionedThroughputProspect && !saving;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close add prospect dialog"
        className="absolute inset-0 bg-zinc-950/20"
        onClick={onClose}
      />
      <div className="absolute left-1/2 top-16 w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg bg-white shadow-[0_24px_80px_rgba(24,24,27,0.28),0_0_0_1px_rgba(24,24,27,0.08)]">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 p-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">Add prospect</h2>
            <p className="mt-1 text-sm text-zinc-500">Search companies already present in calls or tickets.</p>
          </div>
          <button
            type="button"
            aria-label="Close add prospect dialog"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">Company name or domain</span>
            <div className="mt-1 flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 transition-colors focus-within:border-zinc-400">
              <SearchIcon className="size-4 shrink-0 text-zinc-400" />
              <input
                value={search}
                onChange={(event) => onSearchChange({ value: event.target.value })}
                placeholder="Klarna or klarna.com"
                className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-zinc-400"
              />
            </div>
          </label>

          {search.trim().length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50 p-1">
              {options === undefined ? (
                <div className="px-3 py-4 text-sm text-zinc-500">Searching companies...</div>
              ) : options.length > 0 ? (
                options.map((company) => {
                  const logo = faviconUrl({ domain: company.domain });
                  const selected = selectedCompany?.domain === company.domain;
                  const alreadyTracked = company.alreadyProvisionedThroughputProspect;
                  const totalActivity = company.callCount + company.ticketCount;
                  return (
                    <button
                      key={company.domain}
                      type="button"
                      disabled={alreadyTracked}
                      onClick={() => onSelectCompany({ company })}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                        selected ? "bg-white shadow-sm" : alreadyTracked ? "cursor-not-allowed opacity-60" : "hover:bg-white"
                      }`}
                    >
                      {logo ? (
                        <img src={logo} alt="" className="size-7 shrink-0 rounded-sm object-contain shadow-[0_0_0_1px_rgba(24,24,27,0.08)]" />
                      ) : (
                        <Building2Icon className="size-7 shrink-0 rounded-md bg-white p-1.5 text-zinc-400 shadow-[0_0_0_1px_rgba(24,24,27,0.08)]" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-950">{company.name}</span>
                        <span className="block truncate font-mono text-xs text-zinc-400">
                          {company.domain} · {company.callCount} call{company.callCount === 1 ? "" : "s"} · {company.ticketCount} ticket{company.ticketCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      <span className="rounded-md bg-white px-2 py-1 text-[11px] font-medium capitalize text-zinc-500 shadow-[0_0_0_1px_rgb(244_244_245)]">
                        {alreadyTracked ? "Tracked" : `${totalActivity} source${totalActivity === 1 ? "" : "s"}`}
                      </span>
                    </button>
                  );
                })
              ) : exactTrackedMatch ? (
                <div className="px-3 py-4 text-sm text-zinc-500">{exactTrackedMatch.name} is already tracked.</div>
              ) : (
                <div className="px-3 py-4 text-sm text-zinc-500">No matching company with calls or tickets found.</div>
              )}
            </div>
          )}

          <div className="flex justify-end border-t border-zinc-100 pt-4">
            <button
              type="button"
              disabled={!canSave}
              onClick={onSave}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition-[opacity,transform] hover:opacity-90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PlusIcon className="size-4" />
              {saving ? "Adding..." : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachEvidenceDialog({
  search,
  sourceFilter,
  options,
  savingKey,
  onSearchChange,
  onSourceFilterChange,
  onTogglePin,
  loadSource,
  onClose,
}: {
  search: string;
  sourceFilter: EvidenceSourceFilter;
  options?: ProspectEvidenceOption[];
  savingKey: string | null;
  onSearchChange: ({ value }: { value: string }) => void;
  onSourceFilterChange: ({ value }: { value: EvidenceSourceFilter }) => void;
  onTogglePin: ({ option }: { option: ProspectEvidenceOption }) => void;
  loadSource: ({ reference }: { reference: SourceReference }) => Promise<SourceDetail | null>;
  onClose: () => void;
}) {
  const visibleOptions = (options ?? []).filter((option) => sourceFilter === "all" || option.source === sourceFilter);
  const sourceCounts = {
    call: (options ?? []).filter((option) => option.source === "call").length,
    support: (options ?? []).filter((option) => option.source === "support").length,
    slack: (options ?? []).filter((option) => option.source === "slack").length,
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" data-prospect-attach-dialog="true">
      <button
        type="button"
        aria-label="Close attach evidence dialog"
        className="absolute inset-0 bg-zinc-950/20"
        onClick={onClose}
      />
      <div className="absolute left-1/2 top-12 flex max-h-[calc(100vh-6rem)] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-lg bg-white shadow-[0_24px_80px_rgba(24,24,27,0.28),0_0_0_1px_rgba(24,24,27,0.08)]">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 p-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">Attach evidence</h2>
            <p className="mt-1 text-sm text-zinc-500">Company calls, tickets, and Slack mentions</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-zinc-100 p-4">
          <label className="relative block min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(event) => onSearchChange({ value: event.target.value })}
              placeholder="Search calls, tickets, and Slack"
              className="h-10 w-full rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            />
          </label>
          <div className="inline-flex shrink-0 rounded-md bg-zinc-100 p-1">
            {(["all", "call", "support", "slack"] as const).map((value) => {
              const disabled = value === "call" ? sourceCounts.call === 0
                : value === "support" ? sourceCounts.support === 0
                : value === "slack" ? sourceCounts.slack === 0
                : false;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSourceFilterChange({ value })}
                  className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${sourceFilter === value ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-950"}`}
                >
                  {value === "all" ? (
                    <FileTextIcon className="size-3.5" />
                  ) : value === "call" ? (
                    <HeadphonesIcon className="size-3.5" />
                  ) : value === "support" ? (
                    <TicketIcon className="size-3.5" />
                  ) : (
                    <MessageSquareIcon className="size-3.5" />
                  )}
                  {value === "all"
                    ? "All"
                    : value === "call"
                      ? `Calls ${sourceCounts.call}`
                      : value === "support"
                        ? `Tickets ${sourceCounts.support}`
                        : `Slack ${sourceCounts.slack}`}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {options === undefined ? (
            <div className="h-32 animate-pulse rounded-lg bg-zinc-50" />
          ) : visibleOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
              No matching calls, tickets, or Slack mentions.
            </div>
          ) : (
            <div className="space-y-2">
              {visibleOptions.map((option) => {
                const key = `${option.source}:${option.id}`;
                const isSaving = savingKey === key;
                if (option.source === "slack" && option.slack) {
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <SlackMentionCard
                          mention={{
                            channelName: option.slack.channelName,
                            text: option.snippet,
                            authorName: option.slack.authorName,
                            avatarUrl: option.slack.authorAvatar,
                            postedAt: option.date ?? "",
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => onTogglePin({ option })}
                        className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition disabled:opacity-60 ${option.alreadyPinned ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100" : "bg-zinc-950 text-white hover:opacity-90"}`}
                      >
                        {option.alreadyPinned ? <CheckIcon className="size-4" /> : <PinIcon className="size-4" />}
                        {option.alreadyPinned ? "Pinned" : "Pin"}
                      </button>
                    </div>
                  );
                }
                const reference: SourceReference = {
                  source: option.source === "slack" ? "call" : option.source,
                  id: option.id,
                  title: option.title,
                  date: option.date,
                  snippets: option.snippet ? [option.snippet] : undefined,
                };
                return (
                  <div key={key} className="flex items-center gap-2">
                    <SourceViewer
                      reference={reference}
                      mode="button"
                      loadSource={loadSource}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => onTogglePin({ option })}
                      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition disabled:opacity-60 ${option.alreadyPinned ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100" : "bg-zinc-950 text-white hover:opacity-90"}`}
                    >
                      {option.alreadyPinned ? <CheckIcon className="size-4" /> : <PinIcon className="size-4" />}
                      {option.alreadyPinned ? "Pinned" : "Pin"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProspectsClient({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const convexAuth = useConvexAuth();
  const canLoadProspects = !convexAuth.isLoading && convexAuth.isAuthenticated;
  const dashboard = useQuery(api.prospects.getProspectDashboard, canLoadProspects ? {} : "skip");
  const upsertSegment = useMutation(api.prospects.upsertSegment);
  const addManualProspect = useMutation(api.prospects.addManualProvisionedThroughputProspect);
  const removeProspect = useMutation(api.prospects.removeProvisionedThroughputProspect);
  const pinProspectEvidence = useMutation(api.prospects.pinProspectEvidence);
  const unpinProspectEvidence = useMutation(api.prospects.unpinProspectEvidence);
  const pinProspectSlackEvidence = useMutation(api.prospects.pinProspectSlackEvidence);
  const unpinProspectSlackEvidence = useMutation(api.prospects.unpinProspectSlackEvidence);
  const setProspectOutcome = useMutation(api.prospects.setProspectOutcome);
  const getSourceDetail = useAction(api.prospects.getSourceDetail);
  const refreshSingleProspect = useAction(api.prospects.refreshSingleProspect);

  const selectedKey = searchParams.get("client");

  const [selectedSegmentId, setSelectedSegmentId] = useState<Id<"companySegments"> | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");

  function updateParams({ updates }: { updates: Record<string, string | null> }) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  function setSelectedKey(key: string | null) {
    updateParams({ updates: { client: key } });
  }

  const [editing, setEditing] = useState<EditableSegment | null>(null);
  const [saving, setSaving] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [prospectSearch, setProspectSearch] = useState("");
  const [selectedCompanyOption, setSelectedCompanyOption] = useState<CompanyOption | null>(null);
  const [addingProspect, setAddingProspect] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingProspect, setDeletingProspect] = useState(false);
  const [refreshingProspectKey, setRefreshingProspectKey] = useState<string | null>(null);
  const [attachEvidenceOpen, setAttachEvidenceOpen] = useState(false);
  const [evidenceSearch, setEvidenceSearch] = useState("");
  const [evidenceSourceFilter, setEvidenceSourceFilter] = useState<EvidenceSourceFilter>("all");
  const [pinningEvidenceKey, setPinningEvidenceKey] = useState<string | null>(null);
  const [editingOutcome, setEditingOutcome] = useState(false);
  const [outcomeForm, setOutcomeForm] = useState<OutcomeFormState | null>(null);
  const [savingOutcome, setSavingOutcome] = useState(false);
  const companyOptions = useQuery(
    api.prospects.searchCompanyProfiles,
    addDialogOpen && canLoadProspects ? { search: prospectSearch, limit: 8 } : "skip",
  );

  const segments = (dashboard ?? []) as SegmentDashboard[];
  const allAccounts = useMemo(
    () => buildAccounts({ segments, selectedSegmentId }),
    [segments, selectedSegmentId],
  );
  const filteredAccounts = useMemo(
    () => filterAccountsByOutcome({ accounts: allAccounts, outcomeFilter }),
    [allAccounts, outcomeFilter],
  );
  const accounts = useMemo(
    () => visibleAccounts({ accounts: filteredAccounts, sortMode }),
    [filteredAccounts, sortMode],
  );
  const outcomeCounts = useMemo(() => {
    const counts: Record<ProspectOutcome, number> = { active: 0, lost: 0, won: 0, stalled: 0 };
    for (const account of allAccounts) counts[outcomeOf({ membership: account.primary })]++;
    return counts;
  }, [allAccounts]);
  const selectedAccount = useMemo(
    () => selectedKey ? allAccounts.find((account) => account.key === selectedKey) ?? null : null,
    [allAccounts, selectedKey],
  );
  const selectedSlackMentions = useQuery(
    api.slackMentions.getCompanySlackMentions,
    selectedAccount?.company ? { companyId: selectedAccount.company._id, limit: 20 } : "skip",
  );
  const selectedActivity = useQuery(
    api.prospects.getCompanyRecentActivity,
    selectedAccount?.company ? { companyId: selectedAccount.company._id, limit: 50 } : "skip",
  );
  const selectedPinnedActivity = useQuery(
    api.prospects.getCompanyPinnedActivity,
    selectedAccount?.company ? { companyId: selectedAccount.company._id } : "skip",
  );
  const selectedKeyEvidence = useQuery(
    api.prospects.getCompanyKeyEvidence,
    selectedAccount?.company ? { companyId: selectedAccount.company._id } : "skip",
  );
  const selectedTimeline = useMemo(
    () => buildSidePanelTimeline({
      activity: selectedActivity,
      slackMentions: selectedSlackMentions,
      pinnedActivity: selectedPinnedActivity,
      keyEvidence: selectedKeyEvidence,
    }),
    [selectedActivity, selectedSlackMentions, selectedPinnedActivity, selectedKeyEvidence],
  );
  const selectedHasEvidence = selectedTimeline.length > 0;
  const selectedBrief = useMemo(
    () => selectedAccount ? prospectBrief({ account: selectedAccount }) : null,
    [selectedAccount],
  );
  const selectedSegment = selectedSegmentId === "all"
    ? null
    : segments.find((segment) => segment._id === selectedSegmentId) ?? null;
  const evidenceOptions = useQuery(
    api.prospects.getProspectEvidenceOptions,
    attachEvidenceOpen && selectedAccount?.company && canLoadProspects
      ? {
          companyId: selectedAccount.company._id,
          segmentId: selectedAccount.primary.segment._id,
          search: evidenceSearch,
          limit: 30,
        }
      : "skip",
  );

  const latestReflection = useQuery(
    api.companyTimeline.getLatestReflection,
    selectedAccount?.company && canLoadProspects
      ? { companyId: selectedAccount.company._id }
      : "skip",
  );

  useEffect(() => {
    if (convexAuth.isLoading || convexAuth.isAuthenticated) return;
    router.replace("/");
  }, [convexAuth.isAuthenticated, convexAuth.isLoading, router]);

  useEffect(() => {
    setEditingOutcome(false);
    setOutcomeForm(null);
  }, [selectedKey]);

  useEffect(() => {
    if (!selectedKey) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (document.querySelector("[data-source-detail-modal='true']")) return;
      if (document.querySelector("[data-prospect-delete-dialog='true']")) return;
      if (document.querySelector("[data-prospect-attach-dialog='true']")) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select, [contenteditable='true']") || target.closest("[role='dialog']"))
      ) {
        return;
      }
      if (event.key === "Escape") {
        setSelectedKey(null);
        return;
      }
      event.preventDefault();
      const currentIndex = accounts.findIndex((account) => account.key === selectedKey);
      if (currentIndex < 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), accounts.length - 1);
      const nextAccount = accounts[nextIndex];
      if (nextAccount && nextAccount.key !== selectedKey) setSelectedKey(nextAccount.key);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [accounts, selectedKey]);

  useEffect(() => {
    if (!deleteDialogOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDeleteDialogOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteDialogOpen]);

  async function handleSaveSegment() {
    if (!editing) return;
    setSaving(true);
    try {
      await upsertSegment({
        segmentId: editing.segmentId,
        title: editing.title,
        description: editing.description,
        status: "active",
        audience: "prospects",
        detectionPrompt: editing.detectionPrompt,
        searchQueries: [editing.detectionPrompt],
        positiveSignals: [],
        negativeSignals: [],
        refreshCadence: "daily",
      });
      setEditing(null);
      toast.success("Segment saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save segment.");
    } finally {
      setSaving(false);
    }
  }

  function closeAddDialog() {
    setAddDialogOpen(false);
    setProspectSearch("");
    setSelectedCompanyOption(null);
  }

  async function handleAddProspect() {
    if (!selectedCompanyOption) {
      toast.error("Choose a company with calls or tickets first.");
      return;
    }
    const name = selectedCompanyOption.name;
    const domain = selectedCompanyOption.domain;
    setAddingProspect(true);
    try {
      const result = await addManualProspect({
        companyId: selectedCompanyOption.companyId,
        name,
        domain,
      });
      closeAddDialog();
      toast.success(result.membershipCreated ? "Prospect added. Refresh started." : "Prospect was already tracked. Refresh started.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add prospect.");
    } finally {
      setAddingProspect(false);
    }
  }

  async function handleDeleteProspect() {
    if (!selectedAccount?.company) return;
    setDeletingProspect(true);
    try {
      const result = await removeProspect({ companyId: selectedAccount.company._id });
      setDeleteDialogOpen(false);
      setSelectedKey(null);
      toast.success(result.removed ? "Prospect removed." : "Prospect was already removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove prospect.");
    } finally {
      setDeletingProspect(false);
    }
  }

  async function handleRefreshProspect() {
    if (!selectedAccount?.company) return;
    const companyId = selectedAccount.company._id;
    const segmentId = selectedAccount.primary.segment._id;
    setRefreshingProspectKey(selectedAccount.key);
    try {
      const result = await refreshSingleProspect({ companyId, segmentId });
      toast.success(
        result.accepted
          ? `Refreshed. Fit score ${result.fitScore} · ${result.stage}.`
          : `Refreshed, but the classifier did not accept this prospect (fit score ${result.fitScore}).`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not refresh this prospect.");
    } finally {
      setRefreshingProspectKey(null);
    }
  }

  function closeAttachEvidenceDialog() {
    setAttachEvidenceOpen(false);
    setEvidenceSearch("");
    setEvidenceSourceFilter("all");
    setPinningEvidenceKey(null);
  }

  async function handleToggleEvidencePin({ option }: { option: ProspectEvidenceOption }) {
    if (!selectedAccount?.company) return;
    const key = `${option.source}:${option.id}`;
    setPinningEvidenceKey(key);
    try {
      if (option.source === "slack") {
        const mentionId = option.id as Id<"slackCompanyMentions">;
        if (option.alreadyPinned) {
          const result = await unpinProspectSlackEvidence({
            companyId: selectedAccount.company._id,
            segmentId: selectedAccount.primary.segment._id,
            mentionId,
          });
          toast.success(result.unpinned ? "Slack mention unpinned." : "Slack mention was already unpinned.");
        } else {
          await pinProspectSlackEvidence({
            companyId: selectedAccount.company._id,
            segmentId: selectedAccount.primary.segment._id,
            mentionId,
          });
          toast.success("Slack mention pinned.");
        }
        return;
      }
      if (option.alreadyPinned) {
        const result = await unpinProspectEvidence({
          companyId: selectedAccount.company._id,
          segmentId: selectedAccount.primary.segment._id,
          source: option.source,
          id: option.id,
        });
        toast.success(result.unpinned ? "Evidence unpinned." : "Evidence was already unpinned.");
      } else {
        await pinProspectEvidence({
          companyId: selectedAccount.company._id,
          segmentId: selectedAccount.primary.segment._id,
          reference: {
            source: option.source,
            id: option.id,
            title: option.title,
            date: option.date,
            snippet: option.snippet,
          },
        });
        toast.success("Evidence pinned.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update pinned evidence.");
    } finally {
      setPinningEvidenceKey(null);
    }
  }

  function handleOpenOutcomeEditor() {
    if (!selectedAccount) return;
    setOutcomeForm(outcomeToFormState({ membership: selectedAccount.primary }));
    setEditingOutcome(true);
  }

  function handleCancelOutcomeEditor() {
    setEditingOutcome(false);
    setOutcomeForm(null);
  }

  async function handleSaveOutcome() {
    if (!selectedAccount?.company || !outcomeForm) return;
    setSavingOutcome(true);
    try {
      await setProspectOutcome({
        companyId: selectedAccount.company._id,
        segmentId: selectedAccount.primary.segment._id,
        outcome: outcomeForm.outcome,
        lostToCompetitor: outcomeForm.lostToCompetitor.trim() || undefined,
        lostReason: outcomeForm.lostReason.trim() || undefined,
        competitorsConsidered: outcomeForm.competitorsConsidered
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setEditingOutcome(false);
      setOutcomeForm(null);
      toast.success("Outcome updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update outcome.");
    } finally {
      setSavingOutcome(false);
    }
  }

  const loadSource = useCallback(async ({ reference }: { reference: SourceReference }): Promise<SourceDetail | null> => {
    try {
      return await getSourceDetail({ source: reference.source, id: reference.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load source.");
      return null;
    }
  }, [getSourceDetail]);

  if (convexAuth.isLoading || !convexAuth.isAuthenticated || dashboard === undefined) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-5">
        <div className="h-48 animate-pulse rounded-lg bg-white shadow-sm" />
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-5">
        <h1 className="text-xl font-semibold text-zinc-950">Preparing prospect groups</h1>
        <p className="mt-2 text-sm text-zinc-500">The default groups will appear here in a moment.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Provisioned Throughput Prospects</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">
            Potential PT prospects and information about them
          </p>
        </div>
      </div>

      {isAdmin && addDialogOpen && (
        <AddProspectDialog
          search={prospectSearch}
          options={companyOptions}
          selectedCompany={selectedCompanyOption}
          saving={addingProspect}
          onSearchChange={({ value }) => {
            setProspectSearch(value);
            setSelectedCompanyOption(null);
          }}
          onSelectCompany={({ company }) => {
            setSelectedCompanyOption(company);
            setProspectSearch(company.name);
          }}
          onClose={closeAddDialog}
          onSave={handleAddProspect}
        />
      )}

      {isAdmin && attachEvidenceOpen && (
        <AttachEvidenceDialog
          search={evidenceSearch}
          sourceFilter={evidenceSourceFilter}
          options={evidenceOptions}
          savingKey={pinningEvidenceKey}
          onSearchChange={({ value }) => setEvidenceSearch(value)}
          onSourceFilterChange={({ value }) => setEvidenceSourceFilter(value)}
          onTogglePin={handleToggleEvidencePin}
          loadSource={loadSource}
          onClose={closeAttachEvidenceDialog}
        />
      )}

      {editing && (
        <div className="mb-4">
          <SegmentForm
            value={editing}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={handleSaveSegment}
            saving={saving}
          />
        </div>
      )}

      {segments.length > 1 && (
        <div className="mb-4 flex items-center gap-1 overflow-x-auto rounded-lg bg-white p-1 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
          <button
            type="button"
            onClick={() => {
              setSelectedSegmentId("all");
              setSelectedKey(null);
            }}
            className={`flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
              selectedSegmentId === "all"
                ? "bg-zinc-950 text-white"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            All prospects
            <span className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums ${
              selectedSegmentId === "all" ? "bg-white/15" : "bg-zinc-100 text-zinc-500"
            }`}>
              {buildAccounts({ segments, selectedSegmentId: "all" }).length}
            </span>
          </button>
          {segments.map((segment) => {
            const selected = selectedSegmentId === segment._id;
            return (
              <div
                key={segment._id}
                className={`flex shrink-0 overflow-hidden rounded-md ${
                  selected ? "bg-zinc-950 text-white" : "text-zinc-500"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSegmentId(segment._id);
                    setSelectedKey(null);
                }}
                className={`flex min-h-9 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium transition-colors ${
                  selected ? "text-white" : "hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                {segment.title}
                <HoverCard openDelay={150} closeDelay={80}>
                  <HoverCardTrigger asChild>
                    <span
                      aria-label={`${segment.title} details`}
                      className="inline-flex size-5 items-center justify-center rounded-md opacity-70 transition-colors hover:bg-white/10 hover:opacity-100"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <InfoIcon className="size-3.5" />
                    </span>
                  </HoverCardTrigger>
                  <HoverCardContent
                    align="start"
                    className="w-80 rounded-lg border-0 bg-white p-3 text-left shadow-[0_18px_56px_rgba(24,24,27,0.18),0_0_0_1px_rgba(24,24,27,0.08)]"
                  >
                    <div className="text-sm font-semibold text-zinc-950">{segment.title}</div>
                    <p className="mt-1 text-sm leading-5 text-zinc-600">{segment.description}</p>
                    <div className="mt-3 rounded-md bg-zinc-50 p-2 shadow-[inset_0_0_0_1px_rgb(244_244_245)]">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Detection prompt</div>
                      <p className="mt-1 text-xs leading-5 text-zinc-600">{segment.detectionPrompt}</p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
                <span className={`rounded px-1.5 py-0.5 text-[11px] tabular-nums ${
                  selected ? "bg-white/15" : "bg-zinc-100 text-zinc-500"
                }`}>
                  {segment.memberships.length}
                </span>
              </button>
                {isAdmin && selected && (
                  <button
                    type="button"
                    title={`Edit ${segment.title}`}
                    onClick={() => setEditing(segmentToEditable({ segment }))}
                    className="flex min-h-9 w-9 items-center justify-center border-l border-white/15 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 rounded-lg bg-white p-2 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-baseline justify-between gap-2 px-1 sm:justify-start">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Pipeline</span>
            <span className="text-xs font-medium tabular-nums text-zinc-500">{allAccounts.length} prospects</span>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-4 rounded-md bg-zinc-100 p-0.5 shadow-[inset_0_0_0_1px_rgba(24,24,27,0.04)] sm:flex sm:flex-none">
            {([
              { value: "all", label: "All" },
              { value: "open", label: "Open" },
              { value: "lost", label: "Lost" },
              { value: "won", label: "Won" },
            ] as const).map((option) => {
              const selected = outcomeFilter === option.value;
              const count = outcomeFilterCount({
                filter: option.value,
                total: allAccounts.length,
                counts: outcomeCounts,
              });
              const FilterIcon = outcomeFilterIcon({ filter: option.value });
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOutcomeFilter(option.value)}
                  className={`flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-sm font-medium transition-[background-color,color,box-shadow,transform] active:scale-[0.96] sm:min-w-24 ${outcomeFilterClasses({ filter: option.value, selected })}`}
                >
                  {FilterIcon ? (
                    <FilterIcon className="size-3.5 shrink-0" />
                  ) : (
                    <span className={`size-1.5 rounded-full ${outcomeFilterDotClasses({ filter: option.value })}`} />
                  )}
                  <span className="truncate">{option.label}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                    selected ? "bg-zinc-100 text-zinc-600" : "bg-white/70 text-zinc-500"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setAddDialogOpen(true)}
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] transition-[opacity,transform] hover:opacity-90 active:scale-[0.96]"
          >
            <PlusIcon className="size-4" />
            Add prospect
          </button>
        )}
      </div>

      <div className="relative">
        <section className="overflow-x-auto rounded-lg bg-white shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
          <div className="min-w-[1120px]">
            <div className="grid grid-cols-[220px_96px_124px_minmax(340px,1fr)_minmax(280px,0.78fr)] gap-4 border-b border-zinc-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <span>Account</span>
              <button
                type="button"
                onClick={() => setSortMode("recent")}
                className={`flex items-center gap-1 text-left uppercase whitespace-nowrap tracking-wide transition-colors hover:text-zinc-700 ${
                  sortMode === "recent" ? "text-zinc-900" : ""
                }`}
              >
                Last signal
                <span className="text-[10px]">{sortMode === "recent" ? "↓" : "↕"}</span>
              </button>
              <span>Status</span>
              <button
                type="button"
                onClick={() => setSortMode("priority")}
                className={`flex items-center gap-1 text-left uppercase tracking-wide transition-colors hover:text-zinc-700 ${
                  sortMode === "priority" ? "text-zinc-900" : ""
                }`}
              >
                Prospect signal
                <span className="text-[10px]">{sortMode === "priority" ? "↓" : "↕"}</span>
              </button>
              <span>Evidence / next step</span>
            </div>
            <div className="divide-y divide-zinc-50">
              {accounts.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <SearchIcon className="mx-auto size-5 text-zinc-300" />
                  <h2 className="mt-3 text-sm font-semibold text-zinc-950">No qualified prospects</h2>
                  <p className="mt-1 text-sm text-zinc-500">No accounts match this category yet.</p>
                </div>
              ) : (
                accounts.map((account, accountIndex) => {
                const company = account.company;
                const companyName = displayCompanyName({ company });
                const logo = faviconUrl({ domain: company?.domain });
                const selected = selectedAccount?.key === account.key;
                const statusBadge = statusBadgeForAccount({ account });
                const brief = prospectBrief({ account });
                const competitorsConsidered = account.primary.competitorsConsidered ?? [];
                const outcome = outcomeOf({ membership: account.primary });
                const StatusIcon = statusBadge.Icon;
                const statusSubLabel = competitorsConsidered.length > 0 ? `vs ${competitorsConsidered.join(", ")}` : `${account.fitScore} fit score`;
                return (
                  <button
                    key={account.key}
                    onClick={() => setSelectedKey(account.key)}
                    className={`group grid w-full grid-cols-[220px_96px_124px_minmax(340px,1fr)_minmax(280px,0.78fr)] items-start gap-4 px-4 py-4 text-left transition-colors ${rowClassesForAccount({ outcome, selected })}`}
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-zinc-400">
                        {accountIndex + 1}
                      </span>
                      {logo ? (
                        <img src={logo} alt="" className="mt-0.5 size-5 shrink-0 rounded-sm object-contain shadow-[0_0_0_1px_rgba(24,24,27,0.08)]" />
                      ) : (
                        <Building2Icon className="mt-0.5 size-5 shrink-0 text-zinc-400" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-zinc-950">{companyName}</span>
                        <span className="block truncate font-mono text-[11px] text-zinc-400">{company?.domain ?? "unknown"}</span>
                      </span>
                    </span>

                    <span className="text-xs leading-5 text-zinc-500">
                      <span className="font-semibold text-zinc-950">{formatShortDate({ timestamp: account.lastSeenAt })}</span>
                      <span className="block text-zinc-400">{relativeAge({ timestamp: account.lastSeenAt })}</span>
                    </span>

                    <span className="min-w-0">
                      <span className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ring-1 ${statusBadge.classes}`}>
                        {statusBadge.dot ? (
                          <span className={`size-1.5 rounded-full ${statusBadge.dot}`} />
                        ) : StatusIcon ? (
                          <StatusIcon className="size-3.5 shrink-0" />
                        ) : null}
                        <span className="truncate">{statusBadge.label}</span>
                      </span>
                      {statusSubLabel && (
                        <span className="mt-1 block truncate text-[11px] font-medium text-zinc-500">
                          {statusSubLabel}
                        </span>
                      )}
                    </span>

                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm font-medium leading-5 text-zinc-800">
                        {brief.intent || "No concise signal yet."}
                      </span>
                      <span className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                        <span className="inline-flex max-w-full items-center rounded-md bg-zinc-100 px-2 py-1 text-xs leading-4 text-zinc-600">
                          <span className="mr-1 font-semibold text-zinc-400">Scale</span>
                          <span className="truncate">{brief.scale || "Unknown"}</span>
                        </span>
                        {brief.currentStack && (
                          <span className="inline-flex max-w-full items-center rounded-md bg-zinc-100 px-2 py-1 text-xs leading-4 text-zinc-600">
                            <span className="mr-1 font-semibold text-zinc-400">Usage</span>
                            <span className="max-w-[260px] truncate">{brief.currentStack}</span>
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="min-w-0 text-sm leading-5 text-zinc-700">
                      {brief.keyEvidence && (
                        <span className="line-clamp-2 text-zinc-600">
                          {brief.keyEvidence}
                        </span>
                      )}
                      {brief.nextAction && (
                        <span className="mt-2 block truncate text-xs font-medium text-zinc-500">
                          Next: {brief.nextAction}
                        </span>
                      )}
                      {!brief.keyEvidence && !brief.nextAction && (
                        <span className="text-zinc-400">Open for evidence timeline.</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
            </div>
          </div>
        </section>

        {selectedAccount?.company && (() => {
          const selectedCompanyLogo = faviconUrl({ domain: selectedAccount.company.domain });
          const outcome = outcomeOf({ membership: selectedAccount.primary });
          const headerBadge = statusBadgeForAccount({ account: selectedAccount });
          const HeaderIcon = headerBadge.Icon;
          return (
          <>
            <button
              type="button"
              aria-label="Close prospect detail"
              onClick={() => setSelectedKey(null)}
              className="fixed inset-0 z-30 bg-zinc-950/10 lg:bg-transparent"
            />
            <aside className="fixed bottom-4 right-4 top-16 z-40 w-[min(560px,calc(100vw-2rem))] overflow-y-auto rounded-lg bg-white shadow-[0_20px_70px_rgba(24,24,27,0.22),0_0_0_1px_rgba(24,24,27,0.08)]">
            <>
              {/* ── Sticky header ───────────────────────────────── */}
              <div className="sticky top-0 z-10 bg-white px-4 pt-4 pb-3 shadow-[0_1px_0_rgb(244_244_245)]">
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/companies/${encodeURIComponent(selectedAccount.company.domain)}`}
                    className="flex min-w-0 items-center gap-2.5 group"
                  >
                    {selectedCompanyLogo ? (
                      <img
                        src={selectedCompanyLogo}
                        alt=""
                        className="size-9 shrink-0 rounded-md object-contain shadow-[0_0_0_1px_rgba(24,24,27,0.08)] group-hover:shadow-[0_0_0_2px_rgba(24,24,27,0.16)] transition"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 shadow-[inset_0_0_0_1px_rgb(228_228_231)] group-hover:bg-zinc-200 transition">
                        <Building2Icon className="size-4 text-zinc-500" />
                      </span>
                    )}
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-zinc-950 group-hover:underline underline-offset-2">
                        {displayCompanyName({ company: selectedAccount.company })}
                      </h2>
                      <p className="truncate font-mono text-xs text-zinc-400">
                        {selectedAccount.company.domain} · last seen {relativeAge({ timestamp: selectedAccount.lastSeenAt })}
                      </p>
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1">
                    {isAdmin && (
                      <button
                        type="button"
                        aria-label="Refresh this prospect"
                        title="Re-run the AI classification for this prospect"
                        disabled={refreshingProspectKey === selectedAccount.key}
                        onClick={handleRefreshProspect}
                        className="flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RefreshCwIcon className={`size-4 ${refreshingProspectKey === selectedAccount.key ? "animate-spin" : ""}`} />
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        aria-label="Delete prospect"
                        onClick={() => setDeleteDialogOpen(true)}
                        className="flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2Icon className="size-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Close prospect detail"
                      onClick={() => setSelectedKey(null)}
                      className="flex size-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                </div>

                {/* Badges row */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {latestReflection?.riskScore !== undefined && (outcome === "active" || outcome === "stalled") && (
                    <HealthChip score={latestReflection.riskScore} />
                  )}
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ring-1 ${headerBadge.classes}`}>
                    {headerBadge.dot ? (
                      <span className={`size-1.5 rounded-full ${headerBadge.dot}`} />
                    ) : HeaderIcon ? (
                      <HeaderIcon className="size-3.5" />
                    ) : null}
                    {headerBadge.label}
                  </span>
                  {isAdmin && !editingOutcome && (
                    <button
                      type="button"
                      onClick={handleOpenOutcomeEditor}
                      className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-700 hover:underline"
                    >
                      Edit outcome
                    </button>
                  )}
                </div>

                {/* Segment tags */}
                {selectedAccount.memberships.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedAccount.memberships.map((m) => (
                      <span key={m._id} className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                        {m.segment.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Delete dialog ────────────────────────────────── */}
              {isAdmin && deleteDialogOpen && (
                <div
                  data-prospect-delete-dialog="true"
                  className="fixed inset-0 z-50 flex items-center justify-center px-4"
                >
                  <button
                    type="button"
                    aria-label="Cancel prospect deletion"
                    onClick={() => setDeleteDialogOpen(false)}
                    className="absolute inset-0 bg-zinc-950/20"
                  />
                  <div className="relative w-[min(420px,calc(100vw-2rem))] rounded-lg bg-white p-4 shadow-[0_24px_80px_rgba(24,24,27,0.28),0_0_0_1px_rgba(24,24,27,0.08)]">
                    <h3 className="text-base font-semibold text-zinc-950">Delete prospect?</h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Remove {displayCompanyName({ company: selectedAccount.company })} from prospects. Company records, calls, and tickets stay intact.
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                      <button type="button" onClick={() => setDeleteDialogOpen(false)} className="inline-flex min-h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100">
                        Cancel
                      </button>
                      <button type="button" disabled={deletingProspect} onClick={handleDeleteProspect} className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-rose-600 px-3 text-sm font-medium text-white transition-[opacity,transform] hover:opacity-90 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60">
                        <Trash2Icon className="size-4" />
                        {deletingProspect ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Outcome edit form ─────────────────────────────── */}
              {editingOutcome && outcomeForm && (
                <div className="mx-4 mt-4 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <div>
                    <label className="text-xs font-semibold text-zinc-500">Outcome</label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {OUTCOME_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setOutcomeForm({ ...outcomeForm, outcome: option.value })}
                          className={`rounded-md px-2.5 py-1 text-xs font-semibold ring-1 transition-colors ${outcomeForm.outcome === option.value ? "bg-zinc-950 text-white ring-zinc-950" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-100"}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {outcomeForm.outcome === "lost" && (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-zinc-500">Lost to competitor</label>
                        <input type="text" value={outcomeForm.lostToCompetitor} onChange={(e) => setOutcomeForm({ ...outcomeForm, lostToCompetitor: e.target.value })} placeholder="e.g. Fireworks" className="mt-1 w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-zinc-500">Reason</label>
                        <textarea value={outcomeForm.lostReason} onChange={(e) => setOutcomeForm({ ...outcomeForm, lostReason: e.target.value })} placeholder="e.g. Better token-based pricing" rows={2} className="mt-1 w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400" />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-xs font-semibold text-zinc-500">Competitors being considered</label>
                    <input type="text" value={outcomeForm.competitorsConsidered} onChange={(e) => setOutcomeForm({ ...outcomeForm, competitorsConsidered: e.target.value })} placeholder="Comma-separated, e.g. Nebius, Baseten" className="mt-1 w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400" />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={savingOutcome} onClick={handleSaveOutcome} className="inline-flex min-h-8 items-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60">
                      {savingOutcome ? "Saving..." : "Save"}
                    </button>
                    <button type="button" disabled={savingOutcome} onClick={handleCancelOutcomeEditor} className="inline-flex min-h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* ── AI Brief ──────────────────────────────────────── */}
              {selectedBrief && (
                <div className="mx-4 mt-4">
                  <p className="text-sm leading-relaxed text-zinc-700">
                    {selectedBrief.intent || "No account brief yet."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedBrief.scale && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                        <span className="font-semibold text-zinc-400">Scale</span>{selectedBrief.scale}
                      </span>
                    )}
                    {selectedBrief.currentStack && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                        <span className="font-semibold text-zinc-400">Usage</span>{selectedBrief.currentStack}
                      </span>
                    )}
                  </div>
                  {selectedBrief.nextAction && (
                    <p className="mt-2 text-xs text-zinc-500">
                      <span className="font-semibold text-zinc-600">Next:</span> {selectedBrief.nextAction}
                    </p>
                  )}
                  {(selectedAccount.primary.competitorsConsidered ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-zinc-400">vs.</span>
                      {(selectedAccount.primary.competitorsConsidered ?? []).map((competitor) => (
                        <span key={competitor} className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
                          {competitor}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Key evidence ───────────────────────────────── */}
              {(selectedHasEvidence || isAdmin) && (() => {
                const pinnedEvidence = selectedTimeline.filter((ref) => ref.pinned);
                return (
                  <div className="mx-4 mt-5 pb-5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                        <FileTextIcon className="size-3.5" />
                        Key evidence
                        {pinnedEvidence.length > 0 && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-500">
                            {pinnedEvidence.length}
                          </span>
                        )}
                      </div>
                      {isAdmin && (
                        <button type="button" onClick={() => setAttachEvidenceOpen(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-950">
                          <PinIcon className="size-3.5" />
                          Pin evidence
                        </button>
                      )}
                    </div>
                    {pinnedEvidence.length > 0 ? (
                      <div className="space-y-3">
                        {pinnedEvidence.map((ref, index) => (
                          <div key={`${ref.source}:${ref.id}`} className="relative pl-5">
                            <span className="absolute left-1.5 top-2 size-2 rounded-full bg-violet-400 ring-4 ring-white" />
                            {index < pinnedEvidence.length - 1 && (
                              <span className="absolute bottom-[-0.75rem] left-[9px] top-4 w-px bg-zinc-200" />
                            )}
                            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                              {fullDateLabel({ value: ref.date })}
                            </div>
                            <EvidenceSource reference={ref} loadSource={loadSource} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm italic text-zinc-400">No pinned evidence yet for this prospect.</p>
                    )}
                    <Link
                      href={`/companies/${encodeURIComponent(selectedAccount.company.domain)}`}
                      className="mt-4 flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                    >
                      <span>View full company timeline</span>
                      <svg className="size-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </Link>
                  </div>
                );
              })()}
            </>
            </aside>
          </>
          );
        })()}
      </div>
    </div>
  );
}
