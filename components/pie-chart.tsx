"use client";

import { useState } from "react";

export type PieChartSegment = {
  key: string;
  label: string;
  value: number;
  className: string;
};

export function PieChart({
  data,
  formatValue,
  size = 160,
}: {
  data: PieChartSegment[];
  formatValue: (params: { amount: number }) => string;
  size?: number;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const total = data.reduce((sum, segment) => sum + segment.value, 0);
  const positiveSegments = data.filter((segment) => segment.value > 0);

  if (total <= 0 || positiveSegments.length === 0) {
    return <div className="py-6 text-center text-sm text-zinc-500">No revenue to show.</div>;
  }

  const radius = size / 2;
  const center = radius;

  let cumulativeFraction = 0;
  const slices = positiveSegments.map((segment) => {
    const fraction = segment.value / total;
    const startAngle = cumulativeFraction * 2 * Math.PI;
    cumulativeFraction += fraction;
    const endAngle = cumulativeFraction * 2 * Math.PI;
    return { segment, startAngle, endAngle, fraction };
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0">
        {slices.length === 1 ? (
          <circle
            cx={center}
            cy={center}
            r={radius}
            className={`${slices[0].segment.className} transition-opacity ${hoveredKey && hoveredKey !== slices[0].segment.key ? "opacity-40" : "opacity-100"}`}
            onMouseEnter={() => setHoveredKey(slices[0].segment.key)}
            onMouseLeave={() => setHoveredKey(null)}
          />
        ) : (
          slices.map(({ segment, startAngle, endAngle }) => (
            <path
              key={segment.key}
              d={sliceArcPath({ center, radius, startAngle, endAngle })}
              className={`${segment.className} stroke-white transition-opacity ${hoveredKey && hoveredKey !== segment.key ? "opacity-40" : "opacity-100"}`}
              strokeWidth={1.5}
              onMouseEnter={() => setHoveredKey(segment.key)}
              onMouseLeave={() => setHoveredKey(null)}
            />
          ))
        )}
      </svg>
      <div className="space-y-1.5 text-xs">
        {slices.map(({ segment, fraction }) => (
          <div
            key={segment.key}
            className={`flex items-center gap-2 transition-opacity ${hoveredKey && hoveredKey !== segment.key ? "opacity-40" : "opacity-100"}`}
            onMouseEnter={() => setHoveredKey(segment.key)}
            onMouseLeave={() => setHoveredKey(null)}
          >
            <span className={`size-2.5 shrink-0 rounded-sm ${segment.className.replace("fill-", "bg-")}`} />
            <span className="text-zinc-700">{segment.label}</span>
            <span className="font-mono tabular-nums text-zinc-400">{formatValue({ amount: segment.value })}</span>
            <span className="tabular-nums text-zinc-400">({(fraction * 100).toFixed(0)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function sliceArcPath({
  center,
  radius,
  startAngle,
  endAngle,
}: {
  center: number;
  radius: number;
  startAngle: number;
  endAngle: number;
}): string {
  const start = pointOnCircle({ center, radius, angle: startAngle });
  const end = pointOnCircle({ center, radius, angle: endAngle });
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function pointOnCircle({ center, radius, angle }: { center: number; radius: number; angle: number }): { x: number; y: number } {
  return {
    x: center + radius * Math.sin(angle),
    y: center - radius * Math.cos(angle),
  };
}
