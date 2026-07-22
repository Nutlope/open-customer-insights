import { REVENUE_CATEGORIES, type RevenueCategory } from "./categories";

export type RevenueDealLike = {
  month: string; // "YYYY-MM"
  year: number;
  date: string;
  amount: number;
  category: RevenueCategory;
};

export type CategoryTotals = Record<RevenueCategory, number>;
export type RevenueGroupBy = "month" | "fiscalQuarter" | "fiscalYear";

export function emptyCategoryTotals(): CategoryTotals {
  return { inference: 0, gpu_cluster: 0, credits_other: 0 };
}

export type MonthlyRevenue = {
  month: string;
  totals: CategoryTotals;
  contractedFutureTotals: CategoryTotals;
  total: number;
  contractedFutureTotal: number;
};

export function monthlyRevenue<T extends RevenueDealLike>({ deals, today = new Date() }: { deals: T[]; today?: Date }): MonthlyRevenue[] {
  const byMonth = new Map<string, CategoryTotals>();
  const futureByMonth = new Map<string, CategoryTotals>();
  for (const deal of deals) {
    const totals = byMonth.get(deal.month) ?? emptyCategoryTotals();
    totals[deal.category] += deal.amount;
    byMonth.set(deal.month, totals);

    if (isContractedFutureRevenue({ deal, today })) {
      const futureTotals = futureByMonth.get(deal.month) ?? emptyCategoryTotals();
      futureTotals[deal.category] += deal.amount;
      futureByMonth.set(deal.month, futureTotals);
    }
  }

  return [...byMonth.entries()]
    .map(([month, totals]) => {
      const contractedFutureTotals = futureByMonth.get(month) ?? emptyCategoryTotals();
      return {
        month,
        totals,
        contractedFutureTotals,
        total: sumCategoryTotals({ totals }),
        contractedFutureTotal: sumCategoryTotals({ totals: contractedFutureTotals }),
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
}

export type YearlyRevenue = {
  year: number;
  totals: CategoryTotals;
  contractedFutureTotals: CategoryTotals;
  total: number;
  contractedFutureTotal: number;
};

export function yearlyRevenue<T extends RevenueDealLike>({ deals, today = new Date() }: { deals: T[]; today?: Date }): YearlyRevenue[] {
  const byYear = new Map<number, CategoryTotals>();
  const futureByYear = new Map<number, CategoryTotals>();
  for (const deal of deals) {
    const totals = byYear.get(deal.year) ?? emptyCategoryTotals();
    totals[deal.category] += deal.amount;
    byYear.set(deal.year, totals);

    if (isContractedFutureRevenue({ deal, today })) {
      const futureTotals = futureByYear.get(deal.year) ?? emptyCategoryTotals();
      futureTotals[deal.category] += deal.amount;
      futureByYear.set(deal.year, futureTotals);
    }
  }

  return [...byYear.entries()]
    .map(([year, totals]) => {
      const contractedFutureTotals = futureByYear.get(year) ?? emptyCategoryTotals();
      return {
        year,
        totals,
        contractedFutureTotals,
        total: sumCategoryTotals({ totals }),
        contractedFutureTotal: sumCategoryTotals({ totals: contractedFutureTotals }),
      };
    })
    .sort((a, b) => a.year - b.year);
}

export function availableYears<T extends RevenueDealLike>({ deals }: { deals: T[] }): number[] {
  return [...new Set(deals.map((deal) => deal.year))].sort((a, b) => b - a);
}

export function availableFiscalYears<T extends RevenueDealLike>({ deals }: { deals: T[] }): number[] {
  return [...new Set(deals.map((deal) => fiscalPeriodForDate({ value: deal.date }).fiscalYear))].sort((a, b) => b - a);
}

export function totalsByCategory<T extends RevenueDealLike>({ deals }: { deals: T[] }): CategoryTotals {
  const totals = emptyCategoryTotals();
  for (const deal of deals) {
    totals[deal.category] += deal.amount;
  }
  return totals;
}

export type GroupedRevenue = {
  key: string;
  label: string;
  sortKey: string;
  totals: CategoryTotals;
  contractedFutureTotals: CategoryTotals;
  total: number;
  contractedFutureTotal: number;
};

export function groupedRevenue<T extends RevenueDealLike>({
  deals,
  groupBy,
  today = new Date(),
}: {
  deals: T[];
  groupBy: RevenueGroupBy;
  today?: Date;
}): GroupedRevenue[] {
  if (groupBy === "month") {
    return monthlyRevenue({ deals, today }).map((period) => ({
      key: period.month,
      label: period.month,
      sortKey: period.month,
      totals: period.totals,
      contractedFutureTotals: period.contractedFutureTotals,
      total: period.total,
      contractedFutureTotal: period.contractedFutureTotal,
    }));
  }

  const byPeriod = new Map<string, GroupedRevenue>();
  for (const deal of deals) {
    const fiscalPeriod = fiscalPeriodForDate({ value: deal.date });
    const key = groupBy === "fiscalQuarter" ? `${fiscalPeriod.fiscalYear}-Q${fiscalPeriod.fiscalQuarter}` : String(fiscalPeriod.fiscalYear);
    const existing = byPeriod.get(key) ?? {
      key,
      label: groupBy === "fiscalQuarter" ? `FY${shortYear({ year: fiscalPeriod.fiscalYear })} Q${fiscalPeriod.fiscalQuarter}` : `FY${shortYear({ year: fiscalPeriod.fiscalYear })}`,
      sortKey: groupBy === "fiscalQuarter" ? `${fiscalPeriod.fiscalYear}-${fiscalPeriod.fiscalQuarter}` : String(fiscalPeriod.fiscalYear),
      totals: emptyCategoryTotals(),
      contractedFutureTotals: emptyCategoryTotals(),
      total: 0,
      contractedFutureTotal: 0,
    };

    existing.totals[deal.category] += deal.amount;
    existing.total += deal.amount;

    if (isContractedFutureRevenue({ deal, today })) {
      existing.contractedFutureTotals[deal.category] += deal.amount;
      existing.contractedFutureTotal += deal.amount;
    }

    byPeriod.set(key, existing);
  }

  return [...byPeriod.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export function fiscalPeriodForDate({ value }: { value: string }): { fiscalYear: number; fiscalQuarter: 1 | 2 | 3 | 4 } {
  const date = new Date(value);
  const calendarYear = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const fiscalMonthIndex = (month + 11) % 12;
  const fiscalYear = month >= 1 ? calendarYear + 1 : calendarYear;
  const fiscalQuarter = (Math.floor(fiscalMonthIndex / 3) + 1) as 1 | 2 | 3 | 4;
  return { fiscalYear, fiscalQuarter };
}

export function isContractedFutureRevenue<T extends Pick<RevenueDealLike, "date">>({ deal, today = new Date() }: { deal: T; today?: Date }): boolean {
  return new Date(deal.date).getTime() > today.getTime();
}

function sumCategoryTotals({ totals }: { totals: CategoryTotals }): number {
  return REVENUE_CATEGORIES.reduce((sum, category) => sum + totals[category], 0);
}

function shortYear({ year }: { year: number }): string {
  return String(year).slice(-2);
}
