"use client";

import { ChevronLeftIcon, ChevronRightIcon, TrendingUpIcon } from "lucide-react";
import Link from "next/link";
import type { WeeklyUsage } from "@/lib/convex/usage";

function buildWeekUrl({ weekStart, userId }: { weekStart: string | null; userId: string }): string {
  const params = new URLSearchParams();
  if (userId) params.set("userId", userId);
  if (weekStart) params.set("week", weekStart);
  const qs = params.toString();
  return `/admin${qs ? `?${qs}` : ""}`;
}

function shiftWeek({ weekStart, weeks }: { weekStart: string; weeks: number }): string {
  const d = new Date(weekStart + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export function DauChart({
  data,
  selectedWeek,
  userId,
}: {
  data: WeeklyUsage[];
  selectedWeek?: string;
  userId: string;
}) {
  const maxUsers = Math.max(...data.map((d) => d.users), 1);
  const halfUsers = Math.ceil(maxUsers / 2);

  const thisWeekStart = (() => {
    const now = new Date();
    const dow = now.getUTCDay();
    const dtm = dow === 0 ? 6 : dow - 1;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dtm));
    return d.toISOString().slice(0, 10);
  })();

  const firstWeek = data[0]?.weekStart ?? thisWeekStart;

  const prevWeek = selectedWeek ? shiftWeek({ weekStart: selectedWeek, weeks: -1 }) : null;
  const nextWeek = selectedWeek ? shiftWeek({ weekStart: selectedWeek, weeks: 1 }) : null;
  const canGoPrev = prevWeek !== null && prevWeek >= firstWeek;
  const canGoNext = nextWeek !== null && nextWeek <= thisWeekStart;

  return (
    <div className="rounded-lg bg-white px-5 py-4 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
          <TrendingUpIcon className="size-3.5 text-zinc-400" />
          Weekly active users — last 12 weeks
          {selectedWeek && (
            <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 font-mono text-amber-600">
              w/c {selectedWeek.slice(5)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedWeek ? (
            <>
              {canGoPrev ? (
                <Link
                  href={buildWeekUrl({ weekStart: prevWeek, userId })}
                  className="text-zinc-400 transition-colors hover:text-zinc-700"
                  aria-label="Previous week"
                >
                  <ChevronLeftIcon className="size-3.5" />
                </Link>
              ) : (
                <span className="text-zinc-200" aria-disabled>
                  <ChevronLeftIcon className="size-3.5" />
                </span>
              )}
              {canGoNext ? (
                <Link
                  href={buildWeekUrl({ weekStart: nextWeek, userId })}
                  className="text-zinc-400 transition-colors hover:text-zinc-700"
                  aria-label="Next week"
                >
                  <ChevronRightIcon className="size-3.5" />
                </Link>
              ) : (
                <span className="text-zinc-200" aria-disabled>
                  <ChevronRightIcon className="size-3.5" />
                </span>
              )}
              <Link
                href={buildWeekUrl({ weekStart: null, userId })}
                className="text-[11px] text-zinc-400 transition-colors hover:text-zinc-700"
              >
                clear
              </Link>
            </>
          ) : (
            <span className="text-[11px] tabular-nums text-zinc-400">peak {maxUsers}</span>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        {/* Y-axis labels */}
        <div className="flex w-6 shrink-0 flex-col justify-between pb-1 text-right text-[10px] tabular-nums text-zinc-300">
          <span>{maxUsers}</span>
          <span>{halfUsers}</span>
          <span>0</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-36">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 border-t border-zinc-100" />
              <div className="absolute inset-x-0 top-1/2 border-t border-zinc-100" />
              <div className="absolute inset-x-0 bottom-0 border-t border-zinc-100" />
            </div>

            <div className="absolute inset-0 flex items-end gap-1.5">
              {data.map(({ weekStart, users }) => {
                const pct = maxUsers > 0 ? (users / maxUsers) * 100 : 0;
                const isCurrentWeek = weekStart === thisWeekStart;
                const isSelected = weekStart === selectedWeek;
                const href = buildWeekUrl({ weekStart: isSelected ? null : weekStart, userId });

                return (
                  <Link
                    key={weekStart}
                    href={href}
                    className="group relative flex flex-1 flex-col justify-end"
                    style={{ height: "100%" }}
                    title={`w/c ${weekStart.slice(5)}: ${users} user${users !== 1 ? "s" : ""}`}
                  >
                    {/* Tooltip */}
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1.5 text-center opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      <div className="text-sm font-bold tabular-nums text-white">
                        {users} user{users !== 1 ? "s" : ""}
                      </div>
                      <div className="mt-0.5 text-[10px] text-zinc-400">w/c {weekStart.slice(5)}</div>
                    </div>
                    {/* Bar */}
                    <div
                      className={`w-full rounded-t-sm transition-colors ${
                        isSelected
                          ? "bg-amber-400 group-hover:bg-amber-300"
                          : isCurrentWeek
                          ? "bg-emerald-500 group-hover:bg-emerald-400"
                          : users > 0
                          ? "bg-sky-500 group-hover:bg-sky-400"
                          : "bg-zinc-100 group-hover:bg-zinc-200"
                      }`}
                      style={{ height: users > 0 ? `${Math.max(pct, 5)}%` : "2px" }}
                    />
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-zinc-400">
            <span>{data[0]?.weekStart.slice(5)}</span>
            <span>{data[5]?.weekStart.slice(5)}</span>
            <span>{data[11]?.weekStart.slice(5)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
