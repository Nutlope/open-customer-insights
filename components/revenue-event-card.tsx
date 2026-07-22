import { TrendingUpIcon } from "lucide-react";
import { REVENUE_CATEGORY_LABELS, type RevenueCategory } from "@/lib/revenue/categories";
import { formatRevenueAmount } from "@/lib/revenue/format";

export type RevenueEvent = {
  title: string;
  date: string;
  amount: number;
  category: RevenueCategory;
  opportunityType: "Net New" | "Expansion" | "Renewal";
};

const CATEGORY_THEME: Record<RevenueEvent["category"], { chipClasses: string; iconClasses: string }> = {
  inference: {
    chipClasses: "bg-violet-50 text-violet-700 ring-violet-100",
    iconClasses: "bg-violet-50 text-violet-700 ring-violet-100",
  },
  gpu_cluster: {
    chipClasses: "bg-amber-50 text-amber-700 ring-amber-100",
    iconClasses: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  credits_other: {
    chipClasses: "bg-zinc-100 text-zinc-600 ring-zinc-200",
    iconClasses: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  },
};

function formatDealDate({ value }: { value: string }): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function RevenueEventCard({ deal }: { deal: RevenueEvent }) {
  const theme = CATEGORY_THEME[deal.category];
  return (
    <div className="rounded-lg bg-white p-3 shadow-[0_1px_2px_rgb(24_24_27/0.04),0_0_0_1px_rgb(228_228_231)]">
      <div className="flex min-w-0 items-start gap-2 text-xs text-zinc-500">
        <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ${theme.iconClasses}`}>
          <TrendingUpIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-zinc-700">{deal.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${theme.chipClasses}`}>{REVENUE_CATEGORY_LABELS[deal.category]}</span>
            <span>{formatDealDate({ value: deal.date })}</span>
            <span>{deal.opportunityType}</span>
          </div>
        </div>
        <span className="shrink-0 text-sm font-semibold text-emerald-700">{formatRevenueAmount({ amount: deal.amount })}</span>
      </div>
    </div>
  );
}
