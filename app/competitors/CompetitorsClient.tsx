"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { XIcon, ArrowLeftIcon, SearchXIcon } from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { COMPETITORS } from "@/lib/competitors";
import { SourceViewer, type SourceDetail, type SourceReference } from "@/components/source-detail-renderer";
import { CompetitorLogo } from "./CompetitorLogo";

// ── Snippet highlighting ──────────────────────────────────────────────────────

function buildHighlightPattern(competitorName: string): RegExp | null {
  const competitor = COMPETITORS.find((c) => c.name === competitorName);
  if (!competitor) return null;
  const escaped = [...competitor.variants]
    .sort((a, b) => b.length - a.length) // longest first to avoid partial matches
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Same word-boundary chars as the detection logic
  return new RegExp(`(?<![a-zA-Z0-9\\-_])(${escaped.join("|")})(?![a-zA-Z0-9\\-_])`, "gi");
}

type Row = {
  name: string;
  domain: string;
  calls: number;
  tickets: number;
  total: number;
  lastSeen: string | null;
};

type MentionDetail = {
  sourceType: "call" | "ticket";
  id: string;
  title: string;
  date: string;
  companyDomain: string | undefined;
  snippets: string[];
};

type Range = "week" | "month" | "quarter" | "halfyear" | "year";

const RANGES: { key: Range; label: string }[] = [
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "quarter", label: "3 months" },
  { key: "halfyear", label: "6 months" },
];

const RANGE_DAYS: Record<Range, number> = { week: 7, month: 30, quarter: 90, halfyear: 180, year: 365 };

function getFrom(range: Range): string {
  return new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString();
}

function relativeTime(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function CompetitorsClient({
  initialRows,
  initialRange,
  totalMentions,
  totalCalls,
  totalTickets,
  detectedCount,
  competitorCount,
}: {
  initialRows: Row[];
  initialRange: Range;
  totalMentions: number;
  totalCalls: number;
  totalTickets: number;
  detectedCount: number;
  competitorCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [range, setRange] = useState<Range>(initialRange);
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [totals, setTotals] = useState({ mentions: totalMentions, calls: totalCalls, tickets: totalTickets, detected: detectedCount });
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<MentionDetail[] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingRange, setLoadingRange] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  const fetchSeq = useRef(0);

  const getLeaderboard = useAction(api.competitors.getCompetitorLeaderboard);
  const getMentionDetails = useAction(api.competitors.getCompetitorMentionDetails);
  const getSourceDetail = useAction(api.prospects.getSourceDetail);

  const updateParams = useCallback(
    ({ updates }: { updates: Record<string, string | null> }) => {
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
    },
    [pathname, router, searchParams]
  );

  async function handleRangeChange(newRange: Range) {
    if (newRange === range) return;
    setRange(newRange);
    setSelected(null);
    setDetails(null);
    setMobileView("list");
    setLoadingRange(true);
    updateParams({ updates: { range: newRange === "week" ? null : newRange, competitor: null } });
    try {
      const from = getFrom(newRange);
      const data = await getLeaderboard({ from, range: newRange });
      setRows(data.map((e) => ({ ...e, lastSeen: e.lastSeen ?? null })));
      const men = data.reduce((s, r) => s + r.total, 0);
      const cal = data.reduce((s, r) => s + r.calls, 0);
      const tix = data.reduce((s, r) => s + r.tickets, 0);
      setTotals({ mentions: men, calls: cal, tickets: tix, detected: data.length });
    } finally {
      setLoadingRange(false);
    }
  }

  const handleSelectCompetitor = useCallback(async (name: string) => {
    if (name === selected) {
      setSelected(null);
      setDetails(null);
      setMobileView("list");
      updateParams({ updates: { competitor: null } });
      return;
    }
    setSelected(name);
    setDetails(null);
    setLoadingDetail(true);
    setMobileView("detail");
    updateParams({ updates: { competitor: name } });

    const seq = ++fetchSeq.current;
    try {
      const from = getFrom(range);
      const data = await getMentionDetails({ competitorName: name, from });
      if (seq === fetchSeq.current) {
        setDetails(data);
      }
    } finally {
      if (seq === fetchSeq.current) setLoadingDetail(false);
    }
  }, [getMentionDetails, range, selected, updateParams]);

  function handleBack() {
    setMobileView("list");
    setSelected(null);
    setDetails(null);
    updateParams({ updates: { competitor: null } });
  }

  // Restore selected competitor from the URL on first load (shareable links)
  useEffect(() => {
    const competitorParam = searchParams.get("competitor");
    if (!competitorParam || selected) return;
    if (rows.some((r) => r.name === competitorParam && r.total > 0)) {
      void handleSelectCompetitor(competitorParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSource({ reference }: { reference: SourceReference }): Promise<SourceDetail | null> {
    return await getSourceDetail({ source: reference.source, id: reference.id });
  }

  const sortedRows = [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const highlightPattern = selected ? buildHighlightPattern(selected) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-5">
      {/* Title + tabs + stats */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950">Competitor Intelligence</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold tabular-nums text-zinc-950">
              {totals.mentions.toLocaleString()}
            </span>
            <span className="text-zinc-400">mentions</span>
            <span className="text-zinc-300">·</span>
            <span className="tabular-nums text-emerald-700">
              {totals.calls.toLocaleString()} calls
            </span>
            <span className="text-zinc-300">·</span>
            <span className="tabular-nums text-sky-700">
              {totals.tickets.toLocaleString()} tickets
            </span>
            <span className="text-zinc-300">·</span>
            <span className="text-zinc-400">
              {totals.detected} of {competitorCount} competitors
            </span>
          </div>
        </div>

        {/* Date range tabs */}
        <div className="flex shrink-0 gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
          {RANGES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleRangeChange(key)}
              disabled={loadingRange}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                range === key
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
              }`}
            >
              {loadingRange && range === key && (
                <span className="size-3 animate-spin rounded-full border border-white/40 border-t-white/90" />
              )}
              {label}
            </button>
          ))}
        </div>
      </div>

      {!loadingRange && totals.detected === 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-white px-4 py-3 text-sm shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
          <SearchXIcon className="size-4 shrink-0 text-zinc-300" />
          <span className="text-zinc-500">
            No competitor mentions found in the last {RANGES.find((r) => r.key === range)?.label.toLowerCase()}.
          </span>
          {range !== "halfyear" && (
            <button
              onClick={() => handleRangeChange("halfyear")}
              className="ml-auto shrink-0 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
            >
              Try 6 months
            </button>
          )}
        </div>
      )}

      {/* Two-column layout on lg+, mobile list/detail toggle */}
      <div className="flex gap-4 items-start">

        {/* Leaderboard table — hidden on mobile when detail is open */}
        <div className={`relative flex-1 min-w-0 rounded-lg bg-white shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] overflow-hidden ${selected ? "hidden lg:block" : ""}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100">
                <th className="w-8 py-2.5 pl-4 text-left text-[11px] font-medium text-zinc-400">#</th>
                <th className="py-2.5 pl-2 pr-4 text-left text-[11px] font-medium text-zinc-400">Competitor</th>
                <th className="hidden py-2.5 px-4 text-right text-[11px] font-medium text-zinc-400 sm:table-cell">Calls</th>
                <th className="hidden py-2.5 px-4 text-right text-[11px] font-medium text-zinc-400 sm:table-cell">Tickets</th>
                <th className="py-2.5 px-4 text-right text-[11px] font-medium text-zinc-400">Total</th>
                <th className="hidden py-2.5 pr-4 text-right text-[11px] font-medium text-zinc-400 md:table-cell">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {loadingRange ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td className="w-8 py-3 pl-4">
                      <span className="text-[11px] tabular-nums text-zinc-300">{i + 1}</span>
                    </td>
                    <td className="py-3 pl-2 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div className="size-5 animate-pulse rounded-full bg-zinc-100" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 w-32 animate-pulse rounded bg-zinc-100" />
                          <div className="h-2.5 w-20 animate-pulse rounded bg-zinc-50" />
                        </div>
                      </div>
                    </td>
                    <td className="hidden py-3 px-4 text-right sm:table-cell">
                      <div className="ml-auto h-3 w-6 animate-pulse rounded bg-zinc-100" />
                    </td>
                    <td className="hidden py-3 px-4 text-right sm:table-cell">
                      <div className="ml-auto h-3 w-6 animate-pulse rounded bg-zinc-100" />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="ml-auto h-3 w-6 animate-pulse rounded bg-zinc-100" />
                    </td>
                    <td className="hidden py-3 pr-4 text-right md:table-cell">
                      <div className="ml-auto h-3 w-10 animate-pulse rounded bg-zinc-100" />
                    </td>
                  </tr>
                ))
              ) : sortedRows.map((row, i) => {
                const isSelected = row.name === selected;
                const hasMentions = row.total > 0;
                return (
                  <tr
                    key={row.name}
                    onClick={() => hasMentions && handleSelectCompetitor(row.name)}
                    className={`transition-colors ${
                      isSelected
                        ? "bg-zinc-50 shadow-[inset_3px_0_0_0_#18181b]"
                        : hasMentions
                          ? "hover:bg-zinc-50 cursor-pointer"
                          : "opacity-35"
                    }`}
                  >
                    <td className="w-8 py-3 pl-4">
                      <span className="text-[11px] tabular-nums text-zinc-400">{i + 1}</span>
                    </td>
                    <td className="py-3 pl-2 pr-4">
                      <div className="flex items-center gap-2.5">
                        <CompetitorLogo name={row.name} domain={row.domain} size={20} />
                        <div className="min-w-0">
                          <div className={`truncate font-medium text-zinc-950 ${isSelected ? "font-semibold" : ""}`}>
                            {row.name}
                          </div>
                          <div className="truncate font-mono text-[10px] text-zinc-400">{row.domain}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden py-3 px-4 text-right tabular-nums sm:table-cell">
                      <span className="text-emerald-700">{row.calls > 0 ? row.calls : "—"}</span>
                    </td>
                    <td className="hidden py-3 px-4 text-right tabular-nums sm:table-cell">
                      <span className="text-sky-700">{row.tickets > 0 ? row.tickets : "—"}</span>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">
                      <span className={`font-semibold ${hasMentions ? "text-zinc-950" : "text-zinc-400"}`}>
                        {row.total > 0 ? row.total : "—"}
                      </span>
                    </td>
                    <td className="hidden py-3 pr-4 text-right md:table-cell">
                      <span className="text-xs text-zinc-400">
                        {row.lastSeen ? relativeTime(row.lastSeen) : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className={`w-full lg:w-[380px] lg:flex-shrink-0 rounded-lg bg-white shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] overflow-hidden lg:sticky lg:top-4 ${mobileView === "detail" ? "block" : "hidden lg:block"}`}>
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                {/* Back button — mobile only */}
                <button
                  onClick={handleBack}
                  className="lg:hidden flex-shrink-0 flex items-center justify-center size-7 rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
                >
                  <ArrowLeftIcon className="size-4" />
                </button>
                <CompetitorLogo
                  name={selected}
                  domain={rows.find((r) => r.name === selected)?.domain ?? ""}
                  size={20}
                />
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-zinc-950">{selected}</span>
                  {!loadingDetail && details !== null && (
                    <span className="ml-2 text-xs text-zinc-400">
                      {details.length} source{details.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  setSelected(null);
                  setDetails(null);
                  setMobileView("list");
                  updateParams({ updates: { competitor: null } });
                }}
                className="hidden lg:flex ml-2 flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[70vh] lg:max-h-[calc(100vh-8rem)]">
              {loadingDetail ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-14 animate-pulse rounded-md bg-zinc-50" />
                  ))}
                </div>
              ) : details === null ? null : details.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-400">
                  No mentions found in this time range.
                </div>
              ) : (
                <ul className="divide-y divide-zinc-50">
                  {details.map((detail, idx) => {
                    const reference: SourceReference = {
                      source: detail.sourceType === "call" ? "call" : "support",
                      id: detail.id,
                      title: detail.title,
                      date: detail.date,
                      companyDomain: detail.companyDomain,
                      snippets: detail.snippets,
                    };
                    return (
                    <li key={`${detail.sourceType}-${detail.id}-${idx}`} className="px-4 py-3.5">
                      <SourceViewer
                        reference={reference}
                        highlight={{ pattern: highlightPattern }}
                        loadSource={loadSource}
                      />
                    </li>
                  );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
