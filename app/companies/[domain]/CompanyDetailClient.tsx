"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
import {
  ArrowLeftIcon,
  Building2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  ExternalLinkIcon,
  HeadphonesIcon,
  ListIcon,
  MessageSquareIcon,
  PhoneIcon,
  PinIcon,
  SparklesIcon,
  TicketIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { CompanyLogo } from "@/components/company-logo";
import { HealthChip } from "@/components/health-chip";
import { isPlaceholderDomain } from "@/lib/domain/placeholderDomain";
import {
  SourceViewer,
  type SourceDetail,
  type SourceReference,
} from "@/components/source-detail-renderer";
import { RevenueEventCard } from "@/components/revenue-event-card";
import { SlackMentionCard } from "@/components/slack-mention-card";
import { companyAskPromptHref } from "@/lib/chat/askPrompt";
import { SHOW_HEALTH_SCORES } from "@/lib/features";
import { useCmdkContext } from "@/app/components/CmdkProvider";
import type { CmdkItem } from "@/lib/cmdk/types";
import type { Doc } from "@/convex/_generated/dataModel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency({ amount }: { amount?: number | null }): string | null {
  if (!amount || amount <= 0) return null;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

function weekMonday({ dateStr }: { dateStr: string }): string {
  const [year, month, day] = dateStr.slice(0, 10).split("-").map(Number);
  const dt = new Date(year!, month! - 1, day!);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() - dow + (dow === 0 ? -6 : 1));
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function weekRangeLabel({ key }: { key: string }): { start: string; end: string } {
  const [year, month, day] = key.split("-").map(Number);
  const mon = new Date(year!, month! - 1, day!);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (dt: Date) => dt.toLocaleDateString("en", { month: "short", day: "numeric" });
  return { start: fmt(mon), end: fmt(sun) };
}

function reflAccent({ score }: { score: number }): string {
  if (!SHOW_HEALTH_SCORES) return "border-l-zinc-200";
  if (score >= 61) return "border-l-red-300";
  if (score >= 31) return "border-l-amber-300";
  return "border-l-emerald-300";
}

// ── View mode ─────────────────────────────────────────────────────────────────

type ViewMode = "key" | "full";

function filterByViewMode({
  items,
  mode,
  pinnedSet,
}: {
  items: TimelineItem[];
  mode: ViewMode;
  pinnedSet: Set<string>;
}): TimelineItem[] {
  if (mode === "full") return items;
  return items.filter((i) => {
    if (i.kind === "reflection" || i.kind === "note" || i.kind === "revenue") return true;
    if (i.kind === "call" || i.kind === "support" || i.kind === "slack") return pinnedSet.has(`${i.kind}:${i.id}`);
    return false;
  });
}

// ── Unified item type ─────────────────────────────────────────────────────────

type ActivityItem = {
  kind: "call" | "support";
  date: string;
  id: string;
  title: string;
  companyDomain?: string;
};
type SlackItem = {
  kind: "slack";
  date: string;
  id: string;
  channelName?: string;
  text: string;
  authorName?: string;
  avatarUrl?: string;
};
type RevenueItem = {
  kind: "revenue";
  date: string;
  id: string;
  title: string;
  amount: number;
  category: "inference" | "gpu_cluster" | "credits_other";
  opportunityType: "Net New" | "Expansion" | "Renewal";
};
type ReflectionItem = { kind: "reflection"; date: string; entry: Doc<"companyTimeline"> };
type NoteItem = { kind: "note"; date: string; entry: Doc<"companyTimeline"> };
type TimelineItem = ActivityItem | SlackItem | RevenueItem | ReflectionItem | NoteItem;

// ── Week grouping ─────────────────────────────────────────────────────────────

type WeekGroup = { key: string; items: TimelineItem[] };

function groupByWeek({ items }: { items: TimelineItem[] }): WeekGroup[] {
  const out: WeekGroup[] = [];
  for (const item of items) {
    const k = weekMonday({ dateStr: item.date });
    const g = out.find((x) => x.key === k);
    if (g) g.items.push(item);
    else out.push({ key: k, items: [item] });
  }
  return out;
}

// ── Small UI components ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    customer: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    prospect: "bg-blue-50 text-blue-700 ring-blue-200",
    former_customer: "bg-orange-50 text-orange-700 ring-orange-200",
    unknown: "bg-zinc-100 text-zinc-500 ring-zinc-200",
  };
  const labels: Record<string, string> = {
    customer: "Customer",
    prospect: "Prospect",
    former_customer: "Former customer",
    unknown: "Unknown",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${styles[status] ?? styles.unknown}`}>
      {labels[status] ?? status}
    </span>
  );
}

function CompTag({ name }: { name: string }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-50 text-orange-700 ring-1 ring-orange-200">
      {name}
    </span>
  );
}

function WeekDateLabel({ weekKey }: { weekKey: string }) {
  const { start, end } = weekRangeLabel({ key: weekKey });
  return (
    <div className="text-right leading-none">
      <span className="text-xs font-semibold text-zinc-500 tabular-nums">{start}</span>
      <span className="text-[10px] text-zinc-400 tabular-nums block mt-0.5">– {end}</span>
    </div>
  );
}

function MonthDivider({ weekKey }: { weekKey: string }) {
  const [year, month, day] = weekKey.split("-").map(Number);
  const label = new Date(year!, month! - 1, day!).toLocaleDateString("en", { month: "long", year: "numeric" });
  return (
    <div className="grid grid-cols-[88px_1fr] gap-x-5">
      <div />
      <div className="flex items-center gap-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-300">{label}</span>
        <div className="flex-1 border-t border-zinc-100" />
      </div>
    </div>
  );
}

function RoutineAccordion({
  count,
  open,
  onToggle,
  label,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  const displayLabel = label ?? "routine item";
  return (
    <div>
      <button onClick={onToggle} className="flex w-full items-center gap-2 py-1 group">
        <div className="flex-1 border-t border-zinc-100 group-hover:border-zinc-200 transition" />
        <span className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] text-zinc-400 group-hover:border-zinc-300 group-hover:text-zinc-600 transition select-none">
          {open ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
          {count} {displayLabel}{count === 1 ? "" : "s"}
        </span>
        <div className="flex-1 border-t border-zinc-100 group-hover:border-zinc-200 transition" />
      </button>
      {open && <div className="mt-2 space-y-2 opacity-50">{children}</div>}
    </div>
  );
}

// ── Note card ─────────────────────────────────────────────────────────────────

function NoteCard({ item }: { item: NoteItem }) {
  const { user } = useUser();
  const isCurrentUser = !!user?.primaryEmailAddress?.emailAddress &&
    user.primaryEmailAddress.emailAddress === item.entry.authorEmail;
  const avatarUrl = isCurrentUser ? user.imageUrl : null;
  const initials = (item.entry.authorEmail ?? "?")[0]?.toUpperCase() ?? "?";
  const dateStr = new Date(item.entry.date).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="rounded-lg bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
      <div className="flex items-start gap-2.5">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="size-6 rounded-full shrink-0 mt-0.5" />
        ) : (
          <div className="size-6 rounded-full bg-zinc-200 text-zinc-600 flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 mb-1">
            <span className="text-xs font-medium text-zinc-700">{item.entry.authorEmail ?? "Note"}</span>
            <span className="text-[10px] text-zinc-400">{dateStr}</span>
          </div>
          <p className="text-sm text-zinc-700 leading-relaxed">{item.entry.content}</p>
        </div>
      </div>
    </div>
  );
}

// ── Item card renderer ────────────────────────────────────────────────────────

function ItemCard({
  item,
  loadSource,
  pinned,
}: {
  item: TimelineItem;
  loadSource: ({ reference }: { reference: SourceReference }) => Promise<SourceDetail | null>;
  pinned?: boolean;
}) {
  if (item.kind === "call" || item.kind === "support") {
    return (
      <div>
        {pinned && (
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-violet-600">
            <PinIcon className="size-2.5" />
            Pinned
          </div>
        )}
        <SourceViewer
          reference={{ source: item.kind, id: item.id, title: item.title, date: item.date, companyDomain: item.companyDomain }}
          loadSource={loadSource}
        />
      </div>
    );
  }
  if (item.kind === "slack") {
    return (
      <div>
        {pinned && (
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-violet-600">
            <PinIcon className="size-2.5" />
            Pinned
          </div>
        )}
        <SlackMentionCard
          mention={{ channelName: item.channelName, text: item.text, authorName: item.authorName, avatarUrl: item.avatarUrl, postedAt: item.date }}
        />
      </div>
    );
  }
  if (item.kind === "revenue") {
    return (
      <RevenueEventCard
        deal={{ title: item.title, date: item.date, amount: item.amount, category: item.category, opportunityType: item.opportunityType }}
      />
    );
  }
  if (item.kind === "note") {
    return <NoteCard item={item} />;
  }
  return null;
}

// ── Activity count summary (highlights mode) ─────────────────────────────────

type WeekCounts = { calls: number; tickets: number; slack: number };

type ActivityCountItem = { Icon: React.ElementType; count: number; label: string };

function WeekActivitySummary({ counts }: { counts: WeekCounts }) {
  const items: ActivityCountItem[] = [];
  if (counts.calls > 0) items.push({ Icon: HeadphonesIcon, count: counts.calls, label: counts.calls === 1 ? "call" : "calls" });
  if (counts.tickets > 0) items.push({ Icon: TicketIcon, count: counts.tickets, label: counts.tickets === 1 ? "ticket" : "tickets" });
  if (counts.slack > 0) items.push({ Icon: MessageSquareIcon, count: counts.slack, label: counts.slack === 1 ? "mention" : "mentions" });

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {items.map(({ Icon, count, label }) => (
        <span key={label} className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
          <Icon className="size-3 shrink-0" />
          <span className="tabular-nums font-medium">{count}</span>
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}

// ── Sticky floating header ────────────────────────────────────────────────────

function ViewModeToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: ViewMode;
  onViewModeChange: ({ mode }: { mode: ViewMode }) => void;
}) {
  return (
    <div className="flex rounded-md bg-zinc-100 p-0.5">
      <button
        onClick={() => onViewModeChange({ mode: "key" })}
        title="AI-curated view: reflections, pinned moments, and revenue"
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
          viewMode === "key"
            ? "bg-white text-zinc-950 shadow-sm"
            : "text-zinc-500 hover:text-zinc-700"
        }`}
      >
        <SparklesIcon className="size-3" />
        AI Summary
      </button>
      <button
        onClick={() => onViewModeChange({ mode: "full" })}
        title="Full activity log: all calls, tickets, Slack mentions, and revenue"
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
          viewMode === "full"
            ? "bg-white text-zinc-950 shadow-sm"
            : "text-zinc-500 hover:text-zinc-700"
        }`}
      >
        <ListIcon className="size-3" />
        All activity
      </button>
    </div>
  );
}

function CompanyStickyHeader({
  name,
  status,
  domain,
  viewMode,
  onViewModeChange,
  visible,
}: {
  name: string;
  status: string;
  domain: string;
  viewMode: ViewMode;
  onViewModeChange: ({ mode }: { mode: ViewMode }) => void;
  visible: boolean;
}) {
  return (
    <div
      className={`fixed top-14 left-0 right-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-sm transition-all duration-200 ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
      }`}
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-2 flex items-center gap-3">
        <CompanyLogo domain={domain} name={name} size="size-7" rounded="rounded-md" textSize="text-xs" />
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm font-semibold text-zinc-950 truncate">{name}</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ViewModeToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
          <a
            href={companyAskPromptHref({ name, domain })}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 transition"
          >
            <SparklesIcon className="size-3" />
            Ask AI
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Single week row ───────────────────────────────────────────────────────────

function WeekRow({
  weekGroup: { key, items },
  loadSource,
  pinnedSet,
  viewMode,
  weekCounts,
  showMonthDivider,
  isMoreOpen,
  onToggleMore,
}: {
  weekGroup: WeekGroup;
  loadSource: ({ reference }: { reference: SourceReference }) => Promise<SourceDetail | null>;
  pinnedSet: Set<string>;
  viewMode: ViewMode;
  weekCounts: Map<string, WeekCounts>;
  showMonthDivider: boolean;
  isMoreOpen: boolean;
  onToggleMore: () => void;
}) {
  const refl = items.find((i): i is ReflectionItem => i.kind === "reflection");
  const activity = items.filter((i) => i.kind !== "reflection");
  const riskScore = refl?.entry.riskScore;
  const notable =
    riskScore !== undefined &&
    refl !== undefined &&
    (riskScore >= 40 || (refl.entry.detectedCompetitors?.length ?? 0) > 0);

  const layerA = activity.filter((i) => i.kind === "note" || i.kind === "revenue");
  const pinnedNonSlack = activity.filter(
    (i) => (i.kind === "call" || i.kind === "support") && pinnedSet.has(`${i.kind}:${i.id}`),
  );
  const pinnedSlack = activity.filter(
    (i) => i.kind === "slack" && pinnedSet.has(`${i.kind}:${i.id}`),
  );
  const layerB = [...pinnedNonSlack, ...pinnedSlack];
  const allUnpinned = activity.filter(
    (i) =>
      (i.kind === "call" || i.kind === "support" || i.kind === "slack") &&
      !pinnedSet.has(`${i.kind}:${i.id}`),
  );
  const unpinnedPreview = allUnpinned.slice(0, 5);
  const unpinnedOverflow = allUnpinned.slice(5);

  return (
    <div>
      {showMonthDivider && <MonthDivider weekKey={key} />}
      <div className="grid grid-cols-[88px_1fr] gap-x-5 items-start">
        {/* Left: date + health score */}
        <div className="pt-0.5 flex flex-col items-end gap-2">
          <WeekDateLabel weekKey={key} />
          {riskScore !== undefined && <HealthChip score={riskScore} />}
        </div>

        {/* Right: content */}
        <div className="space-y-2.5 min-w-0">
          {/* Reflection prose */}
          {refl && notable && (
            <div className={`border-l-2 pl-3 ${reflAccent({ score: riskScore! })}`}>
              <p className="text-sm leading-relaxed italic text-zinc-600">{refl.entry.content}</p>
              {(refl.entry.detectedCompetitors?.length ?? 0) > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {refl.entry.detectedCompetitors!.map((c) => <CompTag key={c} name={c} />)}
                </div>
              )}
            </div>
          )}
          {refl && !notable && (
            <p className="text-xs leading-relaxed italic text-zinc-400">{refl.entry.content}</p>
          )}

          {/* Activity count summary in highlights mode */}
          {viewMode === "key" && (() => {
            const counts = weekCounts.get(key);
            return counts ? <WeekActivitySummary counts={counts} /> : null;
          })()}

          {/* Layer A: notes + revenue */}
          {layerA.length > 0 && (
            <div className="space-y-2">
              {layerA.map((item) => (
                <ItemCard
                  key={`${item.kind}:${"entry" in item ? item.entry._id : item.id}`}
                  item={item}
                  loadSource={loadSource}
                />
              ))}
            </div>
          )}

          {/* Layer B: pinned calls, tickets, and Slack mentions */}
          {layerB.length > 0 && (
            <div className="space-y-2 border-l-2 border-zinc-100 pl-3">
              {layerB.map((item) => (
                <ItemCard
                  key={`${item.kind}:${"id" in item ? item.id : ""}`}
                  item={item}
                  loadSource={loadSource}
                  pinned={"id" in item ? pinnedSet.has(`${item.kind}:${item.id}`) : false}
                />
              ))}
            </div>
          )}

          {/* Non-pinned items: first 5 visible, rest collapsed */}
          {unpinnedPreview.length > 0 && (
            <div className="space-y-2">
              {unpinnedPreview.map((item) => (
                <ItemCard
                  key={`${item.kind}:${"id" in item ? item.id : ""}`}
                  item={item}
                  loadSource={loadSource}
                />
              ))}
            </div>
          )}
          {unpinnedOverflow.length > 0 && (
            <RoutineAccordion
              count={unpinnedOverflow.length}
              open={isMoreOpen}
              label="more event"
              onToggle={onToggleMore}
            >
              {unpinnedOverflow.map((item) => (
                <ItemCard
                  key={`${item.kind}:${"id" in item ? item.id : ""}`}
                  item={item}
                  loadSource={loadSource}
                />
              ))}
            </RoutineAccordion>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Week timeline ─────────────────────────────────────────────────────────────

function WeekTimeline({
  weeks,
  loadSource,
  pinnedSet,
  viewMode,
  weekCounts,
}: {
  weeks: WeekGroup[];
  loadSource: ({ reference }: { reference: SourceReference }) => Promise<SourceDetail | null>;
  pinnedSet: Set<string>;
  viewMode: ViewMode;
  weekCounts: Map<string, WeekCounts>;
}) {
  const [openMore, setOpenMore] = useState<Set<string>>(new Set());

  function toggleMore({ key }: { key: string }) {
    setOpenMore((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const weeksWithDividers = weeks.map((week, i) => ({
    week,
    showMonthDivider: week.key.slice(0, 7) !== (weeks[i - 1]?.key.slice(0, 7) ?? ""),
  }));

  return (
    <div className="space-y-6">
      {weeksWithDividers.map(({ week, showMonthDivider }) => (
        <WeekRow
          key={week.key}
          weekGroup={week}
          loadSource={loadSource}
          pinnedSet={pinnedSet}
          viewMode={viewMode}
          weekCounts={weekCounts}
          showMonthDivider={showMonthDivider}
          isMoreOpen={openMore.has(week.key)}
          onToggleMore={() => toggleMore({ key: week.key })}
        />
      ))}
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export function CompanyDetailClient({ domain }: { domain: string }) {
  const [viewMode, setViewMode] = useState<ViewMode>("full");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteDate, setNoteDate] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  });
  const [noteSaving, setNoteSaving] = useState(false);
  const [showStickyHeader, setShowStickyHeader] = useState(false);

  // Callback ref so the observer attaches after company data loads and the card renders.
  const headerCardRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyHeader(!entry!.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    // No cleanup needed — element unmounts only when navigating away.
  }, []);

  const company = useQuery(api.companies.getCompany, { domain });
  const activity = useQuery(
    api.prospects.getCompanyRecentActivity,
    company?._id ? { companyId: company._id, fullHistory: true } : "skip"
  );
  const revenueDeals = useQuery(
    api.revenue.getRevenueDealsForCompany,
    company?._id ? { companyId: company._id } : "skip"
  );
  const slackMentions = useQuery(
    api.slackMentions.getCompanySlackMentions,
    company?._id ? { companyId: company._id, limit: 20 } : "skip"
  );
  const timelineEntries = useQuery(
    api.companyTimeline.getCompanyTimeline,
    company?._id ? { companyId: company._id, limit: 30 } : "skip"
  );
  const keyEvidence = useQuery(
    api.prospects.getCompanyKeyEvidence,
    company?._id ? { companyId: company._id } : "skip"
  );
  const pinnedActivity = useQuery(
    api.prospects.getCompanyPinnedActivity,
    company?._id ? { companyId: company._id } : "skip"
  );

  const addNote = useMutation(api.companyTimeline.addManualNote);
  const getSourceDetail = useAction(api.prospects.getSourceDetail);
  const router = useRouter();

  async function loadSource({ reference }: { reference: SourceReference }): Promise<SourceDetail | null> {
    return await getSourceDetail({ source: reference.source, id: reference.id });
  }

  const cmdkItems = useMemo<CmdkItem[]>(() => {
    if (!company) return [];
    return [
      { type: "copy", label: "Copy domain", value: company.domain, icon: <CopyIcon className="size-4 shrink-0 text-zinc-400" /> },
      { type: "external", label: "Open website", href: `https://${company.domain}`, icon: <ExternalLinkIcon className="size-4 shrink-0 text-zinc-400" /> },
      {
        type: "external",
        label: "Open in Salesforce",
        href: `https://app.salesforce.com/${company.salesforceId}`,
        icon: <ExternalLinkIcon className="size-4 shrink-0 text-zinc-400" />,
        hidden: !company.salesforceId,
      },
      {
        type: "action",
        label: "Scroll to activity",
        icon: <PhoneIcon className="size-4 shrink-0 text-zinc-400" />,
        onSelect: () => document.getElementById("activity")?.scrollIntoView({ behavior: "smooth" }),
      },
      {
        type: "action",
        label: "Scroll to tickets",
        icon: <TicketIcon className="size-4 shrink-0 text-zinc-400" />,
        onSelect: () => document.getElementById("activity")?.scrollIntoView({ behavior: "smooth" }),
      },
    ];
  }, [company, router]);
  useCmdkContext({ items: cmdkItems, key: "company-detail" });

  function handleCloseModal() {
    setNoteOpen(false);
    setNoteContent("");
  }

  async function handleSaveNote() {
    if (!company?._id || !noteContent.trim()) return;
    setNoteSaving(true);
    try {
      await addNote({
        companyId: company._id,
        content: noteContent.trim(),
        date: new Date(noteDate + "T12:00:00").getTime(),
      });
      setNoteContent("");
      setNoteOpen(false);
    } finally {
      setNoteSaving(false);
    }
  }

  // Build unified sorted timeline
  const allItems: TimelineItem[] = [];
  const activityKeys = new Set<string>();
  const slackKeys = new Set<string>();

  if (activity) {
    for (const item of activity) {
      activityKeys.add(`${item.source}:${item.id}`);
      allItems.push({ kind: item.source as "call" | "support", date: item.date, id: item.id, title: item.title, companyDomain: item.companyDomain });
    }
  }
  if (slackMentions) {
    for (const m of slackMentions) {
      slackKeys.add(`slack:${m._id}`);
      allItems.push({ kind: "slack", date: m.postedAt, id: m._id, channelName: m.channelName, text: m.text, authorName: m.resolvedAuthorName, avatarUrl: m.avatarUrl });
    }
  }
  // Always include pinned items even if outside the recent-50 window
  if (pinnedActivity) {
    for (const item of pinnedActivity) {
      const key = `${item.source}:${item.id}`;
      if (item.source === "slack") {
        if (slackKeys.has(key)) continue;
        allItems.push({
          kind: "slack",
          date: item.date,
          id: item.id,
          channelName: item.slackChannelName,
          text: item.slackText ?? "",
          authorName: item.slackAuthorName,
          avatarUrl: item.slackAuthorAvatar,
        });
        slackKeys.add(key);
        continue;
      }
      if (activityKeys.has(key)) continue;
      allItems.push({ kind: item.source, date: item.date, id: item.id, title: item.title, companyDomain: item.companyDomain });
    }
  }
  if (revenueDeals) {
    for (const d of revenueDeals) {
      allItems.push({ kind: "revenue", date: d.date, id: d._id, title: d.label, amount: d.amount, category: d.category, opportunityType: d.opportunityType });
    }
  }
  if (timelineEntries) {
    for (const e of timelineEntries) {
      const date = new Date(e.date).toISOString().slice(0, 10);
      allItems.push(
        e.type === "ai_reflection"
          ? { kind: "reflection", date, entry: e }
          : { kind: "note", date, entry: e },
      );
    }
  }
  allItems.sort((a, b) => b.date.localeCompare(a.date));

  // Per-week activity counts used in highlights mode
  const weekCounts = new Map<string, WeekCounts>();
  for (const item of allItems) {
    if (item.kind !== "call" && item.kind !== "support" && item.kind !== "slack") continue;
    const k = weekMonday({ dateStr: item.date });
    const c = weekCounts.get(k) ?? { calls: 0, tickets: 0, slack: 0 };
    if (item.kind === "call") c.calls++;
    else if (item.kind === "support") c.tickets++;
    else c.slack++;
    weekCounts.set(k, c);
  }

  const pinnedSet = new Set((keyEvidence ?? []).map((item) => `${item.source}:${item.id}`));
  const filteredItems = filterByViewMode({ items: allItems, mode: viewMode, pinnedSet });
  const weeks = groupByWeek({ items: filteredItems });
  const timelineLoading =
    activity === undefined ||
    slackMentions === undefined ||
    timelineEntries === undefined ||
    revenueDeals === undefined ||
    keyEvidence === undefined;

  if (company === undefined) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-zinc-100" />
          <div className="h-32 animate-pulse rounded-xl bg-zinc-100" />
        </div>
      </div>
    );
  }

  if (company === null) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 text-center">
        <Building2Icon className="mx-auto size-8 text-zinc-300" />
        <h1 className="mt-4 text-lg font-semibold text-zinc-950">Company not found</h1>
        <p className="mt-2 text-sm text-zinc-500">
          No company profile for <span className="font-mono">{domain}</span>.
        </p>
        <Link href="/companies" className="mt-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeftIcon className="size-3.5" />
          Back to companies
        </Link>
      </div>
    );
  }

  const ltr = formatCurrency({ amount: company.lifetimeRevenue });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {/* Sticky header: appears when the main header card scrolls out of view */}
      <CompanyStickyHeader
        name={company.name}
        status={company.status}
        domain={domain}
        viewMode={viewMode}
        onViewModeChange={({ mode }) => setViewMode(mode)}
        visible={showStickyHeader}
      />

      {/* Back */}
      <Link href="/companies" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700 transition mb-5">
        <ArrowLeftIcon className="size-3.5" />
        Companies
      </Link>

      {/* Main header card */}
      <div ref={headerCardRef} className="rounded-xl bg-white p-5 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
        <div className="flex items-start gap-4">
          <CompanyLogo domain={domain} name={company.name} size="size-16" rounded="rounded-xl" textSize="text-2xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-zinc-950">{company.name}</h1>
            {isPlaceholderDomain({ domain }) ? (
              <span className="inline-flex items-center gap-1 font-mono text-sm text-zinc-400 mt-0.5">Domain unknown</span>
            ) : (
              <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-sm text-zinc-400 hover:text-zinc-700 transition mt-0.5">
                {company.domain}
                <ExternalLinkIcon className="size-3" />
              </a>
            )}
            {company.domainAliases && company.domainAliases.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {company.domainAliases.map((alias) => (
                  <span key={alias} className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 ring-1 ring-zinc-200 bg-zinc-50">{alias}</span>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={company.status} />
              {ltr && (
                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200">LTR {ltr}</span>
              )}
              {company.status !== "customer" && company.isPotentialCustomer && (
                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 bg-violet-50 text-violet-700 ring-violet-200">Potential customer</span>
              )}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <a href={companyAskPromptHref({ name: company.name, domain })} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 transition">
              <SparklesIcon className="size-3" />
              Ask AI
            </a>
            {company.salesforceId && (
              <a href={`https://app.salesforce.com/${company.salesforceId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 transition">
                <ExternalLinkIcon className="size-3" />
                Salesforce
              </a>
            )}
          </div>
        </div>
        {company.description && (
          <p className="mt-4 text-sm leading-relaxed text-zinc-600 border-t border-zinc-100 pt-4">{company.description}</p>
        )}
      </div>

      {/* Timeline */}
      <div id="activity" className="mt-6 scroll-mt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-950">
            Timeline
            <span className="ml-1.5 font-normal text-zinc-400">
              ({company.callCount} call{company.callCount === 1 ? "" : "s"} · {company.ticketCount} ticket{company.ticketCount === 1 ? "" : "s"}{company.revenueDealCount > 0 && formatCurrency({ amount: company.revenueTotal }) ? ` · ${formatCurrency({ amount: company.revenueTotal })} revenue` : ""})
            </span>
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <ViewModeToggle viewMode={viewMode} onViewModeChange={({ mode }) => setViewMode(mode)} />
            <button
              onClick={() => setNoteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 transition"
            >
              <MessageSquareIcon className="size-3" />
              Add note
            </button>
          </div>
        </div>

        {/* Add Note Modal */}
        {noteOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-zinc-950/20 backdrop-blur-sm" onClick={handleCloseModal} />
            <div className="relative w-full max-w-md rounded-xl bg-white shadow-[0_8px_32px_rgba(24,24,27,0.16),0_1px_0_rgba(24,24,27,0.08)] p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-zinc-950">Add note</h3>
                <button onClick={handleCloseModal} className="rounded p-1 text-zinc-400 hover:text-zinc-700 transition">
                  <XIcon className="size-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Date</label>
                  <input
                    type="date"
                    value={noteDate}
                    onChange={(e) => setNoteDate(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">Note</label>
                  <textarea
                    className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                    rows={4}
                    placeholder="Add a note about this company…"
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={handleCloseModal}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 transition"
                >
                  Cancel
                </button>
                <button
                  disabled={!noteContent.trim() || noteSaving}
                  onClick={handleSaveNote}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40 transition"
                >
                  {noteSaving ? "Saving…" : "Save note"}
                </button>
              </div>
            </div>
          </div>
        )}

        {timelineLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        ) : weeks.length === 0 ? (
          <div className="rounded-xl bg-white px-5 py-10 text-center shadow-[0_1px_0_rgba(24,24,27,0.08),0_4px_12px_rgba(24,24,27,0.04)]">
            <p className="text-sm text-zinc-500">
              {viewMode === "key"
                ? "No pinned evidence or AI reflections yet. Switch to All activity to see the full log."
                : "No activity recorded for this company yet."}
            </p>
          </div>
        ) : (
          <WeekTimeline
            weeks={weeks}
            loadSource={loadSource}
            pinnedSet={pinnedSet}
            viewMode={viewMode}
            weekCounts={weekCounts}
          />
        )}
      </div>
    </div>
  );
}
