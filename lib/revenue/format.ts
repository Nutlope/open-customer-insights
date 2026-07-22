export function formatRevenueAmount({ amount }: { amount: number }): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

export function formatMonthLabel({ month }: { month: string }): string {
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(`${month}-01`));
}

export function formatMonthName({ month }: { month: string }): string {
  return new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(`${month}-01`));
}

export function formatMonthYear({ month }: { month: string }): string {
  return new Intl.DateTimeFormat("en", { year: "numeric" }).format(new Date(`${month}-01`));
}
