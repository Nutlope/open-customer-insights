"use client";

import { useMemo, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { TrendingUpIcon } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { CompanyLogo } from "@/components/company-logo";
import { PieChart, type PieChartSegment } from "@/components/pie-chart";
import { StackedBarChart, type StackedBarDatum } from "@/components/stacked-bar-chart";
import {
  availableFiscalYears,
  fiscalPeriodForDate,
  groupedRevenue,
  totalsByCategory,
  type CategoryTotals,
  type RevenueGroupBy,
} from "@/lib/revenue/aggregate";
import { REVENUE_CATEGORIES, REVENUE_CATEGORY_BAR_CLASSES, REVENUE_CATEGORY_FILL_CLASSES, REVENUE_CATEGORY_LABELS, type RevenueCategory } from "@/lib/revenue/categories";
import { formatMonthName, formatMonthYear, formatRevenueAmount } from "@/lib/revenue/format";

type YearFilter = number | "all" | "last12";
type PeriodSelection = {
  key: string;
  label: string;
  groupBy: RevenueGroupBy;
  scope: "main" | "fiscalYearTrend";
};

type RevenueDealForSelection = {
  _id: string;
  domain: string;
  date: string;
  month: string;
  amount: number;
  opportunityName: string;
  opportunityType: "Net New" | "Expansion" | "Renewal";
  category: RevenueCategory;
  label: string;
};

const GROUP_BY_OPTIONS: Array<{ value: RevenueGroupBy; label: string }> = [
  { value: "month", label: "Months" },
  { value: "fiscalQuarter", label: "Fiscal quarters" },
];

export function RevenueClient() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const deals = useQuery(api.revenue.listRevenueDeals, !isLoading && isAuthenticated ? {} : "skip");
  const [yearFilter, setYearFilter] = useState<YearFilter>("last12");
  const [groupBy, setGroupBy] = useState<RevenueGroupBy>("month");
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodSelection | null>(null);
  const today = useMemo(() => new Date(), []);

  const fiscalYears = useMemo(() => availableFiscalYears({ deals: deals ?? [] }), [deals]);
  const visibleFiscalYears = useMemo(() => {
    const currentFiscalYear = fiscalPeriodForDate({ value: today.toISOString() }).fiscalYear;
    const preferredYears = [currentFiscalYear, currentFiscalYear - 1, currentFiscalYear - 2];
    return preferredYears.filter((year) => fiscalYears.includes(year));
  }, [fiscalYears, today]);

  const scopedDeals = useMemo(() => {
    if (!deals) return [];
    if (yearFilter === "last12") return deals.filter((deal) => isInTrailingYear({ value: deal.date, today }));
    if (yearFilter === "all") return deals;
    return deals.filter((deal) => fiscalPeriodForDate({ value: deal.date }).fiscalYear === yearFilter);
  }, [deals, today, yearFilter]);

  const grouped = useMemo(() => groupedRevenue({ deals: scopedDeals, groupBy, today }), [groupBy, scopedDeals, today]);
  const fiscalYearTrend = useMemo(() => groupedRevenue({ deals: deals ?? [], groupBy: "fiscalYear", today }), [deals, today]);
  const scopeTotals = useMemo(() => totalsByCategory({ deals: scopedDeals }), [scopedDeals]);
  const scopeTotal = REVENUE_CATEGORIES.reduce((sum, category) => sum + scopeTotals[category], 0);

  const chartData: StackedBarDatum[] = grouped.map((period) => ({
    key: period.key,
    label: chartDatumLabel({ groupBy, label: period.label }),
    groupLabel: chartDatumGroupLabel({ groupBy, label: period.label }),
    segments: segmentsForTotals({ totals: period.totals, contractedFutureTotals: period.contractedFutureTotals }),
  }));

  const pieData: PieChartSegment[] = REVENUE_CATEGORIES.map((category) => ({
    key: category,
    label: REVENUE_CATEGORY_LABELS[category],
    value: scopeTotals[category],
    className: REVENUE_CATEGORY_FILL_CLASSES[category],
  }));

  const fiscalYearChartData: StackedBarDatum[] = fiscalYearTrend.map((period) => ({
    key: period.key,
    label: period.label,
    segments: segmentsForTotals({ totals: period.totals, contractedFutureTotals: period.contractedFutureTotals }),
  }));

  const showFiscalYearTrend = groupBy !== "fiscalYear" && fiscalYearChartData.length > 1;

  const selectedDeals = useMemo(() => {
    if (!deals || !selectedPeriod) return [];
    const sourceDeals = selectedPeriod.scope === "main" ? scopedDeals : deals;
    return sourceDeals
      .filter((deal) => dealMatchesSelection({ deal, selection: selectedPeriod }))
      .sort((a, b) => b.amount - a.amount);
  }, [deals, scopedDeals, selectedPeriod]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-5">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-zinc-950">
          Revenue
          {deals && (
            <span className="ml-2 text-sm font-normal text-zinc-400">
              ({deals.length.toLocaleString()} deals)
            </span>
          )}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">Fiscal quarters start in February.</p>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-md bg-zinc-100 p-0.5">
          <button
            onClick={() => {
              setYearFilter("last12");
              setSelectedPeriod(null);
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              yearFilter === "last12" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            Last 12 months
          </button>
          {visibleFiscalYears.map((year) => (
            <button
              key={year}
              onClick={() => {
                setYearFilter(year);
                setSelectedPeriod(null);
              }}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                yearFilter === year ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              FY{String(year).slice(-2)}
            </button>
          ))}
          <button
            onClick={() => {
              setYearFilter("all");
              setSelectedPeriod(null);
            }}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              yearFilter === "all" ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            All
          </button>
        </div>

        <div className="flex rounded-md bg-zinc-100 p-0.5">
          {GROUP_BY_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setGroupBy(option.value);
                setSelectedPeriod(null);
              }}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                groupBy === option.value ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <section className="rounded-lg bg-white p-4 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
            <TrendingUpIcon className="size-4 text-emerald-600" />
            <span>{revenueChartTitle({ groupBy })}{revenueScopeLabel({ yearFilter })}</span>
            <span className="font-mono text-sm font-normal tabular-nums text-zinc-400">{formatRevenueAmount({ amount: scopeTotal })}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
            {REVENUE_CATEGORIES.map((category) => (
              <div key={category} className="flex items-center gap-1.5">
                <span className={`size-2.5 rounded-sm ${REVENUE_CATEGORY_BAR_CLASSES[category]}`} />
                <span>{REVENUE_CATEGORY_LABELS[category]}</span>
                <span className="font-mono text-zinc-400">{formatRevenueAmount({ amount: scopeTotals[category] })}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm bg-zinc-400 opacity-75"
                style={{ backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.5) 0 2px, transparent 2px 5px)" }}
              />
              <span>Contracted future</span>
            </div>
          </div>
        </div>

        {deals === undefined ? (
          <div className="flex h-64 items-end gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex-1 animate-pulse rounded-t-sm bg-zinc-100" style={{ height: `${30 + (i % 5) * 12}%` }} />
            ))}
          </div>
        ) : chartData.length === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-500">No revenue deals for this period.</div>
        ) : (
          <StackedBarChart
            data={chartData}
            formatValue={formatRevenueAmount}
            height={220}
            onSelect={({ datum }) => setSelectedPeriod({ key: datum.key, label: periodDisplayLabel({ datum }), groupBy, scope: "main" })}
            selectedKey={selectedPeriod?.scope === "main" ? selectedPeriod.key : null}
            scrollToEnd={yearFilter === "all"}
          />
        )}
      </section>

      <section className="mt-4 rounded-lg bg-white p-4 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950">Deals{selectedPeriod ? ` · ${selectedPeriod.label}` : ""}</h2>
            <p className="text-xs text-zinc-500">{selectedPeriod ? `${selectedDeals.length.toLocaleString()} deal${selectedDeals.length === 1 ? "" : "s"}, sorted by amount` : "Click a bar to inspect the underlying deals."}</p>
          </div>
          {selectedPeriod && (
            <button
              onClick={() => setSelectedPeriod(null)}
              className="rounded px-2 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            >
              Clear
            </button>
          )}
        </div>
        {!selectedPeriod ? (
          <div className="py-8 text-center text-sm text-zinc-500">No period selected.</div>
        ) : selectedDeals.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-500">No deals for this period.</div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {selectedDeals.map((deal) => (
              <RevenueDealRow key={deal._id} deal={deal} />
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {showFiscalYearTrend && (
          <section className="rounded-lg bg-white p-4 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] sm:p-5">
            <div className="mb-4 text-sm font-semibold text-zinc-950">Fiscal year trend</div>
            <StackedBarChart
              data={fiscalYearChartData}
              formatValue={formatRevenueAmount}
              height={140}
              onSelect={({ datum }) => setSelectedPeriod({ key: datum.key, label: datum.label, groupBy: "fiscalYear", scope: "fiscalYearTrend" })}
              selectedKey={selectedPeriod?.scope === "fiscalYearTrend" ? selectedPeriod.key : null}
            />
          </section>
        )}

        <section className={`rounded-lg bg-white p-4 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] sm:p-5 ${showFiscalYearTrend ? "" : "lg:col-span-2"}`}>
          <div className="mb-4 flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold text-zinc-950">Revenue by category</h2>
            <span className="text-xs text-zinc-400">{revenueScopeLabel({ yearFilter }).replace(/^ · /, "")}</span>
          </div>
          {deals === undefined ? (
            <div className="flex items-center gap-6">
              <div className="size-40 shrink-0 animate-pulse rounded-full bg-zinc-100" />
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-3 w-32 animate-pulse rounded bg-zinc-100" />
                ))}
              </div>
            </div>
          ) : (
            <PieChart data={pieData} formatValue={formatRevenueAmount} />
          )}
        </section>
      </div>
    </div>
  );
}

function RevenueDealRow({ deal }: { deal: RevenueDealForSelection }) {
  const companyName = companyNameFromDomain({ domain: deal.domain });
  return (
    <div className="flex items-center gap-3 py-2.5">
      <CompanyLogo domain={deal.domain} name={companyName} size="size-8" rounded="rounded-md" textSize="text-xs" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <a href={`/companies/${encodeURIComponent(deal.domain)}`} className="truncate text-sm font-semibold text-zinc-950 hover:text-emerald-700">
            {companyName}
          </a>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">{deal.opportunityType}</span>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">{REVENUE_CATEGORY_LABELS[deal.category]}</span>
        </div>
        <div className="truncate text-xs text-zinc-500">{deal.label || deal.opportunityName}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-sm font-semibold tabular-nums text-zinc-950">{formatRevenueAmount({ amount: deal.amount })}</div>
        <div className="text-xs text-zinc-400">{formatDealDate({ value: deal.date })}</div>
      </div>
    </div>
  );
}

function segmentsForTotals({
  totals,
  contractedFutureTotals,
}: {
  totals: CategoryTotals;
  contractedFutureTotals: CategoryTotals;
}): StackedBarDatum["segments"] {
  return REVENUE_CATEGORIES.flatMap((category) => {
    const contractedFutureValue = contractedFutureTotals[category];
    const actualValue = Math.max(0, totals[category] - contractedFutureValue);

    return [
      {
        key: `${category}-actual`,
        label: REVENUE_CATEGORY_LABELS[category],
        value: actualValue,
        className: REVENUE_CATEGORY_BAR_CLASSES[category],
        status: "actual" as const,
      },
      {
        key: `${category}-contracted-future`,
        label: REVENUE_CATEGORY_LABELS[category],
        value: contractedFutureValue,
        className: REVENUE_CATEGORY_BAR_CLASSES[category],
        status: "contracted_future" as const,
      },
    ];
  });
}

function revenueChartTitle({ groupBy }: { groupBy: RevenueGroupBy }): string {
  if (groupBy === "fiscalQuarter") return "Fiscal quarterly revenue";
  if (groupBy === "fiscalYear") return "Fiscal yearly revenue";
  return "Monthly revenue";
}

function chartDatumLabel({ groupBy, label }: { groupBy: RevenueGroupBy; label: string }): string {
  if (groupBy === "month") return formatMonthName({ month: label });
  if (groupBy === "fiscalQuarter") return label.replace(/^FY\d+\s+/, "");
  return label;
}

function chartDatumGroupLabel({ groupBy, label }: { groupBy: RevenueGroupBy; label: string }): string | undefined {
  if (groupBy === "month") return formatMonthYear({ month: label });
  if (groupBy === "fiscalQuarter") return label.match(/^FY\d+/)?.[0];
  return undefined;
}

function periodDisplayLabel({ datum }: { datum: StackedBarDatum }): string {
  return datum.groupLabel ? `${datum.label} ${datum.groupLabel}` : datum.label;
}

function dealMatchesSelection({
  deal,
  selection,
}: {
  deal: Pick<RevenueDealForSelection, "date" | "month">;
  selection: PeriodSelection;
}): boolean {
  if (selection.groupBy === "month") return deal.month === selection.key;
  const fiscalPeriod = fiscalPeriodForDate({ value: deal.date });
  if (selection.groupBy === "fiscalQuarter") return `${fiscalPeriod.fiscalYear}-Q${fiscalPeriod.fiscalQuarter}` === selection.key;
  return String(fiscalPeriod.fiscalYear) === selection.key;
}

function companyNameFromDomain({ domain }: { domain: string }): string {
  const root = domain.split(".")[0] ?? domain;
  return root
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || domain;
}

function formatDealDate({ value }: { value: string }): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function revenueScopeLabel({ yearFilter }: { yearFilter: YearFilter }): string {
  if (yearFilter === "last12") return " · last 12 months";
  if (yearFilter === "all") return "";
  return ` · FY${String(yearFilter).slice(-2)}`;
}

function isInTrailingYear({ value, today }: { value: string; today: Date }): boolean {
  const date = new Date(value);
  const start = new Date(today);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return date.getTime() >= start.getTime() && date.getTime() <= today.getTime();
}
