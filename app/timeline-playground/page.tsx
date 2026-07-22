"use client";

import { useState } from "react";
import { SHOW_HEALTH_SCORES } from "@/lib/features";
import {
  SparklesIcon, PencilIcon, PinIcon,
  ChevronDownIcon, ChevronUpIcon,
  BookmarkIcon, AlignJustifyIcon,
} from "lucide-react";
import { SourceViewer } from "@/components/source-detail-renderer";
import { SlackMentionCard } from "@/components/slack-mention-card";
import { RevenueEventCard } from "@/components/revenue-event-card";
import { HealthChip } from "@/components/health-chip";
import type { RevenueCategory } from "@/lib/revenue/categories";

// ── Types ─────────────────────────────────────────────────────────────────────

type CallItem    = { kind: "call";       id: string; date: string; title: string; duration: string; participants: string; pinned: boolean };
type TicketItem  = { kind: "ticket";     id: string; date: string; title: string; status: "open" | "resolved"; priority: "high" | "medium" | "low"; pinned: boolean };
type SlackItem   = { kind: "slack";      id: string; date: string; channel: string; text: string; author: string; pinned: boolean };
type ReflItem    = { kind: "reflection"; id: string; date: string; content: string; riskScore: number; riskReason: string; competitors: string[]; pinned: false };
type NoteItem    = { kind: "note";       id: string; date: string; author: string; content: string; pinned: boolean };
type RevenueItem = { kind: "revenue";    id: string; date: string; title: string; amount: number; category: RevenueCategory; opportunityType: "Net New" | "Expansion" | "Renewal"; pinned: false };
type MockItem    = CallItem | TicketItem | SlackItem | ReflItem | NoteItem | RevenueItem;

type ViewMode = "ai" | "highlights" | "full";

// ── Mock data ─────────────────────────────────────────────────────────────────

const ITEMS: MockItem[] = [
  // Week of Jun 9 — HIGH RISK
  { kind: "reflection", id: "r1", date: "2026-06-09",
    content: "Acme has been actively evaluating provisioned throughput. Two calls focused on latency benchmarks for real-time inference. Pricing concerns surfaced in both sessions — they want a 3-month pilot before any commitment. Fireworks AI mentioned explicitly as a fallback option.",
    riskScore: 62, riskReason: "Pricing sensitivity and direct competitor consideration", competitors: ["Fireworks AI"], pinned: false },
  { kind: "call",   id: "c1", date: "2026-06-13", title: "PT benchmarking deep-dive — latency requirements", duration: "47 min", participants: "Sarah Chen, Marcus Webb", pinned: true },
  { kind: "slack",  id: "s1", date: "2026-06-12", channel: "customer-mentions", text: "Acme Corp tweeted about their AI infra stack — comparing Together vs Fireworks for their next product launch", author: "Priya S.", pinned: false },
  { kind: "call",   id: "c2", date: "2026-06-11", title: "Quarterly roadmap sync", duration: "28 min", participants: "Sarah Chen", pinned: false },
  { kind: "ticket", id: "t1", date: "2026-06-10", title: "API rate limiting on serverless inference tier", status: "open", priority: "high", pinned: true },
  { kind: "note",   id: "n1", date: "2026-06-10", author: "you", content: "Marcus confirmed decision needed by end of July. Board approved budget contingent on 30-day pilot.", pinned: true },
  // Week of Jun 2 — quiet, low risk
  { kind: "reflection", id: "r2", date: "2026-06-02",
    content: "Quiet week. One minor ticket resolved without escalation.", riskScore: 18, riskReason: "No active concerns", competitors: [], pinned: false },
  { kind: "ticket", id: "t3", date: "2026-06-03", title: "Model output formatting — minor question", status: "resolved", priority: "low", pinned: false },
  // Week of May 26 — important call, no AI reflection
  { kind: "call",   id: "c3", date: "2026-05-28", title: "Initial PT scoping — use case discovery", duration: "55 min", participants: "Sarah Chen, Marcus Webb, Alex (CTO)", pinned: true },
  // Week of May 19 — pure noise
  { kind: "ticket", id: "t2", date: "2026-05-20", title: "Billing question — May invoice discrepancy", status: "resolved", priority: "low", pinned: false },
  // Week of May 12 — weak slack
  { kind: "slack",  id: "s2", date: "2026-05-15", channel: "sales-signals", text: "Someone at Acme Corp liked our LinkedIn post about the new model release.", author: "Leila K.", pinned: false },
  // April — revenue
  { kind: "revenue", id: "rev1", date: "2026-04-01", title: "Expansion Q2 — inference add-on", amount: 120000, category: "inference", opportunityType: "Expansion", pinned: false },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${(n / 1_000).toFixed(0)}K`;
}

function weekMonday(d: string) {
  const dt = new Date(d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day + (day === 0 ? -6 : 1));
  return dt.toISOString().slice(0, 10);
}

function groupByWeek(items: MockItem[]) {
  const out: { key: string; items: MockItem[] }[] = [];
  for (const item of items) {
    const k = weekMonday(item.date);
    const g = out.find((x) => x.key === k);
    if (g) g.items.push(item); else out.push({ key: k, items: [item] });
  }
  return out;
}

function reflAccent(score: number) {
  if (!SHOW_HEALTH_SCORES) return "border-l-zinc-200";
  if (score >= 61) return "border-l-red-300";
  if (score >= 31) return "border-l-amber-300";
  return "border-l-emerald-300";
}

function isNotable(refl: ReflItem) {
  return refl.riskScore >= 40 || refl.competitors.length > 0;
}

function isLayerC(item: MockItem) {
  if (item.kind === "ticket" && item.priority === "low" && item.status === "resolved") return true;
  if (item.kind === "slack" && !item.pinned) return true;
  return false;
}

// ── Week date label ───────────────────────────────────────────────────────────

function WeekDateLabel({ weekKey }: { weekKey: string }) {
  const mon = new Date(weekKey);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fMonth = (dt: Date) => dt.toLocaleDateString("en", { month: "short" });
  const fDay   = (dt: Date) => dt.toLocaleDateString("en", { day: "numeric" });
  const sameMonth = fMonth(mon) === fMonth(sun);
  return (
    <div className="text-right leading-none">
      <span className="text-xs font-semibold text-zinc-500 tabular-nums">{fMonth(mon)} {fDay(mon)}</span>
      <span className="text-[10px] text-zinc-400 tabular-nums block mt-0.5">
        – {!sameMonth && `${fMonth(sun)} `}{fDay(sun)}
      </span>
    </div>
  );
}

// ── Pinned overlay wrapper ────────────────────────────────────────────────────

function PinnedCard({ pinned, children }: { pinned: boolean; children: React.ReactNode }) {
  if (!pinned) return <>{children}</>;
  return (
    <div className="relative">
      {children}
      <div className="pointer-events-none absolute top-2 right-2 rounded-full bg-violet-50 p-1 ring-1 ring-violet-200 shadow-sm">
        <PinIcon className="size-2.5 text-violet-500" />
      </div>
    </div>
  );
}

// ── Real card renderer ────────────────────────────────────────────────────────

function ActivityCard({ item }: { item: MockItem }) {
  if (item.kind === "call") {
    return (
      <SourceViewer
        reference={{ source: "call", id: item.id, title: item.title, date: item.date, companyDomain: "acme.io" }}
      />
    );
  }
  if (item.kind === "ticket") {
    return (
      <SourceViewer
        reference={{ source: "support", id: item.id, title: item.title, date: item.date }}
      />
    );
  }
  if (item.kind === "slack") {
    return (
      <SlackMentionCard
        mention={{ channelName: item.channel, text: item.text, authorName: item.author, postedAt: item.date }}
      />
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
    return (
      <div className="rounded-lg bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
        <div className="flex items-center gap-1.5 mb-1.5">
          <PencilIcon className="size-3 text-zinc-400" />
          <span className="text-xs text-zinc-400">{item.author}</span>
        </div>
        <p className="text-sm text-zinc-700 leading-relaxed">{item.content}</p>
      </div>
    );
  }
  return null;
}

// ── Competitor tag ────────────────────────────────────────────────────────────

function CompTag({ name }: { name: string }) {
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-50 text-orange-700 ring-1 ring-orange-200">{name}</span>;
}

// ── Reflection prose block ────────────────────────────────────────────────────

function ReflProse({ refl, muted = false }: { refl: ReflItem; muted?: boolean }) {
  if (muted) {
    return (
      <p className="text-xs leading-relaxed italic text-zinc-400">{refl.content}</p>
    );
  }
  return (
    <div className={`border-l-2 pl-3 ${reflAccent(refl.riskScore)}`}>
      <p className="text-sm leading-relaxed italic text-zinc-600">{refl.content}</p>
      {refl.competitors.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {refl.competitors.map((c) => <CompTag key={c} name={c} />)}
        </div>
      )}
    </div>
  );
}

// ── Month divider ─────────────────────────────────────────────────────────────

function MonthDivider({ weekKey }: { weekKey: string }) {
  const label = new Date(weekKey).toLocaleDateString("en", { month: "long", year: "numeric" });
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

// ── Routine items accordion ───────────────────────────────────────────────────

function RoutineAccordion({
  count,
  open,
  onToggle,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-1 group"
      >
        <div className="flex-1 border-t border-zinc-100 group-hover:border-zinc-200 transition" />
        <span className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] text-zinc-400 group-hover:border-zinc-300 group-hover:text-zinc-600 transition select-none">
          {open ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
          {count} routine {count === 1 ? "item" : "items"}
        </span>
        <div className="flex-1 border-t border-zinc-100 group-hover:border-zinc-200 transition" />
      </button>
      {open && (
        <div className="mt-2 space-y-2 opacity-50">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function Timeline({ items, mode }: { items: MockItem[]; mode: ViewMode }) {
  const [openC, setOpenC] = useState<Set<string>>(new Set());
  const weeks = groupByWeek(items);

  // Determine which weeks to show per mode
  const visibleWeeks = weeks.filter(({ items: wItems }) => {
    const refl   = wItems.find((i): i is ReflItem => i.kind === "reflection");
    const notable = refl && isNotable(refl);
    if (mode === "ai")         return !!refl; // only weeks with any reflection
    if (mode === "highlights") return notable || wItems.some((i) => i.pinned);
    return true;
  });

  let lastMonth = "";

  return (
    <div className="space-y-6">
      {visibleWeeks.map(({ key, items: wItems }) => {
        const refl     = wItems.find((i): i is ReflItem => i.kind === "reflection");
        const activity = wItems.filter((i) => i.kind !== "reflection");
        const notable  = refl && isNotable(refl);

        // Month separator
        const thisMonth = key.slice(0, 7);
        const showMonth = thisMonth !== lastMonth;
        lastMonth = thisMonth;

        // Layer splits
        const layerA = activity.filter((i) => i.pinned || i.kind === "note" || i.kind === "revenue");
        const layerB = activity.filter((i) => !i.pinned && i.kind !== "note" && i.kind !== "revenue" && !isLayerC(i));
        const layerC = activity.filter((i) => !i.pinned && isLayerC(i));
        const isCOpen = openC.has(key);

        // Pinned only filter for highlights
        const filteredA = mode === "highlights" ? layerA.filter((i) => i.pinned || i.kind === "note") : layerA;
        const filteredB = mode === "highlights" ? [] : layerB;
        const filteredC = mode === "highlights" ? [] : layerC;

        return (
          <div key={key}>
            {showMonth && <MonthDivider weekKey={key} />}
            <div className="grid grid-cols-[88px_1fr] gap-x-5 items-start">
              {/* Left: date only */}
              <div className="pt-0.5 flex flex-col items-end">
                <WeekDateLabel weekKey={key} />
              </div>

              {/* Right: content */}
              <div className="space-y-2.5 min-w-0">
                {/* Health chip — always first when there's a reflection */}
                {refl && <HealthChip score={refl.riskScore} />}

                {/* Reflection prose — always shown; muted when healthy */}
                {refl && <ReflProse refl={refl} muted={!notable} />}

                {/* Layer A */}
                {filteredA.length > 0 && (
                  <div className="space-y-2">
                    {filteredA.map((item) => (
                      <PinnedCard key={item.id} pinned={"pinned" in item && item.pinned}>
                        <ActivityCard item={item} />
                      </PinnedCard>
                    ))}
                  </div>
                )}

                {/* Layer B */}
                {filteredB.length > 0 && (
                  <div className="space-y-2 border-l-2 border-zinc-100 pl-3">
                    {filteredB.map((item) => <ActivityCard key={item.id} item={item} />)}
                  </div>
                )}

                {/* Layer C */}
                {filteredC.length > 0 && (
                  <RoutineAccordion
                    count={filteredC.length}
                    open={isCOpen}
                    onToggle={() => setOpenC((p) => {
                      const s = new Set(p);
                      if (s.has(key)) s.delete(key); else s.add(key);
                      return s;
                    })}
                  >
                    {filteredC.map((item) => <ActivityCard key={item.id} item={item} />)}
                  </RoutineAccordion>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {visibleWeeks.length === 0 && (
        <p className="text-sm text-zinc-400 italic">Nothing to show for this view.</p>
      )}
    </div>
  );
}

// ── View mode config ──────────────────────────────────────────────────────────

const MODES: { id: ViewMode; label: string; sublabel: string; icon: React.ElementType }[] = [
  { id: "ai",         label: "AI signal",    sublabel: "Health scores only",          icon: SparklesIcon },
  { id: "highlights", label: "Key moments",  sublabel: "AI + pinned items",           icon: BookmarkIcon },
  { id: "full",       label: "Full timeline",sublabel: "All activity, layered",       icon: AlignJustifyIcon },
];

// ── Page ──────────────────────────────────────────────────────────────────────

function MockHeader() {
  return (
    <div className="mb-7 pb-5 border-b border-zinc-100">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-zinc-100 flex items-center justify-center text-xs font-semibold text-zinc-400">A</div>
        <div>
          <p className="text-sm font-semibold text-zinc-950">Acme Corp</p>
          <p className="text-xs text-zinc-400 font-mono">acme.io</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
          <span className="rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200">Customer</span>
          <span className="rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 bg-blue-50 text-blue-700 ring-blue-200">PT prospect</span>
          <span className="rounded-md px-2 py-0.5 text-[10px] font-medium ring-1 bg-zinc-100 text-zinc-600 ring-zinc-200">LTR $120K</span>
        </div>
      </div>
    </div>
  );
}

export default function TimelinePlayground() {
  const [mode, setMode] = useState<ViewMode>("highlights");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      <div className="mb-6">
        <p className="text-[11px] uppercase tracking-widest text-zinc-400 mb-1.5">Timeline playground</p>
        <h1 className="text-lg font-semibold text-zinc-950">Company timeline — V3.5</h1>
        <p className="mt-1 text-sm text-zinc-400">Switch views to see how different roles would consume the same data.</p>
      </div>

      {/* View mode selector */}
      <div className="mb-7 grid grid-cols-3 gap-2">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex flex-col items-start gap-1 rounded-xl border px-3.5 py-3 text-left transition ${
                active
                  ? "border-zinc-900 bg-zinc-950 text-white shadow-sm"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              <Icon className={`size-4 ${active ? "text-white" : "text-zinc-400"}`} />
              <span className="text-xs font-semibold leading-none mt-0.5">{m.label}</span>
              <span className={`text-[10px] leading-snug ${active ? "text-zinc-400" : "text-zinc-400"}`}>{m.sublabel}</span>
            </button>
          );
        })}
      </div>

      <MockHeader />
      <Timeline items={ITEMS} mode={mode} />
    </div>
  );
}
