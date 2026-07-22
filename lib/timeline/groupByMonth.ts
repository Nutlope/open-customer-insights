export function monthLabel({ value }: { value: string }): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(value));
}

export function groupByMonth<T extends { date: string }>({ items }: { items: T[] }): { label: string; items: T[] }[] {
  if (items.length <= 5) return groupByYear({ items });

  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = monthLabel({ value: item.date });
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

export function yearLabel({ value }: { value: string }): string {
  return String(new Date(value).getFullYear());
}

export function groupByYear<T extends { date: string }>({ items }: { items: T[] }): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = yearLabel({ value: item.date });
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}
