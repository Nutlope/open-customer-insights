"use client";

import { useEffect, useRef, useState } from "react";

export type StackedBarSegment = {
  key: string;
  label: string;
  value: number;
  className: string;
  status?: "actual" | "contracted_future";
};

export type StackedBarDatum = {
  key: string;
  label: string;
  groupLabel?: string;
  segments: StackedBarSegment[];
};

export function StackedBarChart({
  data,
  formatValue,
  height = 220,
  minBarWidth = 64,
  minSegmentHeight = 4,
  onSelect,
  selectedKey,
  scrollToEnd = false,
}: {
  data: StackedBarDatum[];
  formatValue: (params: { amount: number }) => string;
  height?: number;
  minBarWidth?: number;
  minSegmentHeight?: number;
  onSelect?: (params: { datum: StackedBarDatum }) => void;
  selectedKey?: string | null;
  scrollToEnd?: boolean;
}) {
  const [hoveredBarKey, setHoveredBarKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const totals = data.map((datum) => datum.segments.reduce((sum, segment) => sum + segment.value, 0));
  const max = outlierAdjustedMax({ totals });
  const groupLabels = contiguousGroupLabels({ data });
  const gridStyle = {
    gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
  };

  useEffect(() => {
    if (!scrollToEnd) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [scrollToEnd, data]);

  return (
    <div ref={scrollRef} className="overflow-x-auto pb-1">
      <div style={{ minWidth: `${data.length * minBarWidth}px` }}>
        <div className="grid items-end gap-2.5" style={{ ...gridStyle, height: `${height + 48}px` }}>
          {data.map((datum, index) => {
            const total = totals[index];
            const isCapped = total > max;
            const isBarHovered = hoveredBarKey === datum.key;
            const isSelected = selectedKey === datum.key;
            const segmentHeights = segmentDisplayHeights({
              height,
              isCapped,
              max,
              minSegmentHeight,
              segments: datum.segments,
              total,
            });
            return (
              <div
                key={datum.key}
                className={`relative flex h-full min-w-0 flex-col items-center justify-end gap-1.5 ${isBarHovered ? "z-20" : "z-0"} ${onSelect ? "cursor-pointer" : ""}`}
                onClick={() => onSelect?.({ datum })}
                onMouseEnter={() => setHoveredBarKey(datum.key)}
                onMouseLeave={() => setHoveredBarKey(null)}
              >
                <span className="h-4 whitespace-nowrap font-mono text-[10px] tabular-nums text-zinc-400">{total > 0 ? formatValue({ amount: total }) : ""}</span>
                <div
                  className={`relative flex w-full flex-col-reverse rounded-t-sm ring-offset-2 ring-offset-white ${isSelected ? "ring-2 ring-zinc-900/35" : ""}`}
                  style={{ height: `${height}px` }}
                >
                  {isCapped && (
                    <div className="pointer-events-none absolute -top-1 left-0 right-0 z-10 flex items-center gap-0.5">
                      <span className="h-px flex-1 bg-zinc-500/45" />
                      <span className="h-1.5 w-px -rotate-12 bg-zinc-500/60" />
                      <span className="h-1.5 w-px -rotate-12 bg-zinc-500/60" />
                      <span className="h-px flex-1 bg-zinc-500/45" />
                    </div>
                  )}
                  {datum.segments.map((segment) => {
                    if (segment.value <= 0) return null;
                    const segmentHeight = segmentHeights.get(segment.key) ?? minSegmentHeight;
                    const isContractedFuture = segment.status === "contracted_future";
                    return (
                      <div
                        key={segment.key}
                        className={`relative w-full ${segment.className} ${isBarHovered ? "opacity-85" : ""} ${isContractedFuture ? "opacity-75" : ""}`}
                        style={{ height: `${segmentHeight}px` }}
                      >
                        {isContractedFuture && (
                          <span
                            className="pointer-events-none absolute inset-0"
                            style={{
                              backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.34) 0 3px, transparent 3px 7px)",
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                {isBarHovered && (
                  <PeriodTooltip align={tooltipAlign({ index, total: data.length })} datum={datum} formatValue={formatValue} total={total} />
                )}
                <span className="h-4 max-w-none whitespace-nowrap text-[10px] text-zinc-500">{datum.label}</span>
              </div>
            );
          })}
        </div>
        {groupLabels.length > 0 && (
          <div className="mt-1 grid gap-2.5" style={gridStyle}>
            {groupLabels.map((group) => (
              <div
                key={`${group.label}-${group.start}`}
                className="border-t border-zinc-200/80 pt-1 text-center text-[10px] font-medium tabular-nums text-zinc-400"
                style={{ gridColumn: `${group.start + 1} / span ${group.length}` }}
              >
                {group.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PeriodTooltip({
  align,
  datum,
  formatValue,
  total,
}: {
  align: "left" | "center" | "right";
  datum: StackedBarDatum;
  formatValue: (params: { amount: number }) => string;
  total: number;
}) {
  const positiveSegments = datum.segments.filter((segment) => segment.value > 0);
  const maxSegmentValue = Math.max(1, ...positiveSegments.map((segment) => segment.value));
  const positionClassName =
    align === "left"
      ? "left-0"
      : align === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <div className={`pointer-events-none absolute bottom-8 z-50 w-56 rounded-md bg-zinc-950 p-2.5 text-white shadow-[0_12px_30px_rgba(24,24,27,0.22)] ${positionClassName}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-xs font-semibold">{datum.groupLabel ? `${datum.label} ${datum.groupLabel}` : datum.label}</div>
        <div className="font-mono text-[11px] tabular-nums text-zinc-300">{formatValue({ amount: total })}</div>
      </div>
      <div className="space-y-1.5">
        {positiveSegments.map((segment) => {
          const width = Math.max(8, (segment.value / maxSegmentValue) * 100);
          const isContractedFuture = segment.status === "contracted_future";
          return (
            <div key={segment.key} className="grid grid-cols-[72px_1fr_48px] items-center gap-2">
              <div className="truncate text-[10px] text-zinc-300">{segment.label}{isContractedFuture ? " future" : ""}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/12">
                <div
                  className={`h-full rounded-full ${segment.className} ${isContractedFuture ? "opacity-75" : ""}`}
                  style={{
                    width: `${width}%`,
                    backgroundImage: isContractedFuture ? "repeating-linear-gradient(135deg, rgba(255,255,255,0.34) 0 2px, transparent 2px 5px)" : undefined,
                  }}
                />
              </div>
              <div className="text-right font-mono text-[10px] tabular-nums text-zinc-300">{formatValue({ amount: segment.value })}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tooltipAlign({ index, total }: { index: number; total: number }): "left" | "center" | "right" {
  if (index < 2) return "left";
  if (index > total - 3) return "right";
  return "center";
}

function contiguousGroupLabels({ data }: { data: StackedBarDatum[] }): Array<{ label: string; start: number; length: number }> {
  const groups: Array<{ label: string; start: number; length: number }> = [];
  for (const [index, datum] of data.entries()) {
    if (!datum.groupLabel) continue;
    const lastGroup = groups.at(-1);
    if (lastGroup?.label === datum.groupLabel && lastGroup.start + lastGroup.length === index) {
      lastGroup.length += 1;
    } else {
      groups.push({ label: datum.groupLabel, start: index, length: 1 });
    }
  }
  return groups;
}

function outlierAdjustedMax({ totals }: { totals: number[] }): number {
  const positiveTotals = totals.filter((total) => total > 0).sort((a, b) => b - a);
  const largest = positiveTotals[0] ?? 1;
  const secondLargest = positiveTotals[1] ?? largest;

  if (largest > secondLargest * 3) {
    return Math.max(1, secondLargest * 1.35);
  }

  return Math.max(1, largest);
}

function segmentDisplayHeights({
  height,
  isCapped,
  max,
  minSegmentHeight,
  segments,
  total,
}: {
  height: number;
  isCapped: boolean;
  max: number;
  minSegmentHeight: number;
  segments: StackedBarSegment[];
  total: number;
}): Map<string, number> {
  const positiveSegments = segments.filter((segment) => segment.value > 0);
  const displayHeights = new Map<string, number>();
  if (positiveSegments.length === 0 || total <= 0) return displayHeights;

  const targetHeight = isCapped ? height : Math.max((total / max) * height, positiveSegments.length * minSegmentHeight);
  const naturalHeights = positiveSegments.map((segment) => ({ segment, height: (segment.value / total) * targetHeight }));
  const smallSegments = naturalHeights.filter((entry) => entry.height < minSegmentHeight);
  const largeSegments = naturalHeights.filter((entry) => entry.height >= minSegmentHeight);
  const remainingHeight = Math.max(0, targetHeight - smallSegments.length * minSegmentHeight);
  const largeNaturalTotal = largeSegments.reduce((sum, entry) => sum + entry.height, 0);

  for (const entry of smallSegments) {
    displayHeights.set(entry.segment.key, minSegmentHeight);
  }

  for (const entry of largeSegments) {
    const adjustedHeight = largeNaturalTotal > 0 ? (entry.height / largeNaturalTotal) * remainingHeight : remainingHeight / largeSegments.length;
    displayHeights.set(entry.segment.key, Math.max(minSegmentHeight, adjustedHeight));
  }

  return displayHeights;
}
