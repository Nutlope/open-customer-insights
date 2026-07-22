import type { Doc, Id } from "../../convex/_generated/dataModel";

type User = Doc<"users">;
type Usage = Doc<"apiKeyUsage">;

export interface UsageSummaryUser {
  userId: Id<"users">;
  clerkId: string;
  name: string;
  email: string;
  total: number;
  chat: number;
  mcp: number;
  other: number;
  chatPercent: number;
  mcpPercent: number;
  firstUsedAt: number | null;
  lastUsedAt: number | null;
}

export interface WeeklyUsage {
  weekStart: string; // YYYY-MM-DD UTC, always a Monday
  users: number;
}

export interface UsageSummary {
  total: number;
  chat: number;
  mcp: number;
  other: number;
  chatPercent: number;
  mcpPercent: number;
  uniqueUsers: number;
  users: UsageSummaryUser[];
  weeklyActiveUsers: WeeklyUsage[];
}

export function getDisplayName({ user }: { user: Pick<User, "email" | "clerkId"> & { name?: string } }): string {
  if (user.name?.trim()) return user.name.trim();
  if (user.email.trim()) return user.email.split("@")[0] ?? user.email;
  return user.clerkId;
}

export function summarizeUsage({
  users,
  usage,
  userFilter,
  weekFilter,
}: {
  users: User[];
  usage: Usage[];
  userFilter?: string;
  weekFilter?: string;
}): UsageSummary {
  const normalizedFilter = userFilter?.trim().toLowerCase();
  const usersById = new Map<Id<"users">, User>();
  for (const user of users) {
    usersById.set(user._id, user);
  }

  // WAU: last 12 weeks, unfiltered. Weeks start on Monday.
  const nowUtc = new Date();
  const dayOfWeek = nowUtc.getUTCDay(); // 0=Sun
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - daysToMonday));
  const windowStart = new Date(thisWeekStart);
  windowStart.setUTCDate(thisWeekStart.getUTCDate() - 11 * 7);

  const wauByWeek = new Map<string, Set<Id<"users">>>();
  for (const row of usage) {
    if (row.timestamp < windowStart.getTime()) continue;
    const d = new Date(row.timestamp);
    const dow = d.getUTCDay();
    const dtm = dow === 0 ? 6 : dow - 1;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dtm));
    const weekKey = monday.toISOString().slice(0, 10);
    if (!wauByWeek.has(weekKey)) wauByWeek.set(weekKey, new Set());
    wauByWeek.get(weekKey)!.add(row.userId);
  }
  const weeklyActiveUsers: WeeklyUsage[] = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(windowStart);
    d.setUTCDate(windowStart.getUTCDate() + i * 7);
    const weekStart = d.toISOString().slice(0, 10);
    return { weekStart, users: wauByWeek.get(weekStart)?.size ?? 0 };
  });

  let weekStartMs: number | undefined;
  let weekEndMs: number | undefined;
  if (weekFilter) {
    const d = new Date(weekFilter + "T00:00:00Z");
    weekStartMs = d.getTime();
    weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;
  }

  const byUser = new Map<Id<"users">, UsageSummaryUser>();
  let total = 0;
  let chat = 0;
  let mcp = 0;
  let other = 0;

  for (const row of usage) {
    if (weekStartMs !== undefined && weekEndMs !== undefined) {
      if (row.timestamp < weekStartMs || row.timestamp >= weekEndMs) continue;
    }

    const user = usersById.get(row.userId);
    if (!user) continue;

    if (normalizedFilter) {
      const haystack = [user._id, user.clerkId, user.email, user.name ?? ""].join(" ").toLowerCase();
      if (!haystack.includes(normalizedFilter)) continue;
    }

    const existing = byUser.get(row.userId) ?? {
      userId: user._id,
      clerkId: user.clerkId,
      name: getDisplayName({ user }),
      email: user.email,
      total: 0,
      chat: 0,
      mcp: 0,
      other: 0,
      chatPercent: 0,
      mcpPercent: 0,
      firstUsedAt: null,
      lastUsedAt: null,
    };

    existing.total += 1;
    total += 1;

    if (row.endpoint === "chat") {
      existing.chat += 1;
      chat += 1;
    } else if (row.endpoint === "mcp") {
      existing.mcp += 1;
      mcp += 1;
    } else {
      existing.other += 1;
      other += 1;
    }

    existing.firstUsedAt = existing.firstUsedAt === null ? row.timestamp : Math.min(existing.firstUsedAt, row.timestamp);
    existing.lastUsedAt = existing.lastUsedAt === null ? row.timestamp : Math.max(existing.lastUsedAt, row.timestamp);
    byUser.set(row.userId, existing);
  }

  const summaries = Array.from(byUser.values())
    .map((user) => ({
      ...user,
      chatPercent: user.total === 0 ? 0 : Math.round((user.chat / user.total) * 100),
      mcpPercent: user.total === 0 ? 0 : Math.round((user.mcp / user.total) * 100),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    });

  return {
    total,
    chat,
    mcp,
    other,
    chatPercent: total === 0 ? 0 : Math.round((chat / total) * 100),
    mcpPercent: total === 0 ? 0 : Math.round((mcp / total) * 100),
    uniqueUsers: summaries.length,
    users: summaries,
    weeklyActiveUsers,
  };
}
