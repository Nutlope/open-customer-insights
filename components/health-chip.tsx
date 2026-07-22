import { SHOW_HEALTH_SCORES } from "@/lib/features";

const R = 11;
const CIRCUMFERENCE = 2 * Math.PI * R;
const CX = 16;

export function HealthChip({ score }: { score: number }) {
  if (!SHOW_HEALTH_SCORES) return null;

  const clamped = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  const strokeColor =
    clamped >= 61 ? "#f87171" : clamped >= 31 ? "#fbbf24" : "#34d399";
  const textColor =
    clamped >= 61 ? "#dc2626" : clamped >= 31 ? "#b45309" : "#059669";
  const label =
    clamped >= 61 ? "At risk" : clamped >= 31 ? "Monitor" : "Healthy";

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: 32, height: 32 }}
      title={SHOW_HEALTH_SCORES ? `${label} · ${clamped}/100` : label}
      aria-label={SHOW_HEALTH_SCORES ? `${label}, risk score ${clamped}` : label}
    >
      <svg
        width={32}
        height={32}
        viewBox="0 0 32 32"
        className="absolute inset-0"
        aria-hidden="true"
      >
        {/* Track */}
        <circle
          cx={CX}
          cy={CX}
          r={R}
          fill="none"
          stroke="#e4e4e7"
          strokeWidth="2.5"
        />
        {/* Progress arc */}
        <circle
          cx={CX}
          cy={CX}
          r={R}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${CX} ${CX})`}
          style={{ transition: "stroke-dashoffset 0.4s cubic-bezier(0.4,0,0.2,1), stroke 0.3s" }}
        />
      </svg>
      {SHOW_HEALTH_SCORES && (
        <span
          className="relative select-none text-[9px] font-bold tabular-nums leading-none"
          style={{ color: textColor }}
        >
          {clamped}
        </span>
      )}
    </span>
  );
}
