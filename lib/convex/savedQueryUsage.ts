import type { Doc, Id } from "../../convex/_generated/dataModel";
import { getDisplayName } from "./usage";

type User = Doc<"users">;
type SavedQuery = Doc<"savedQueries">;
type SavedQueryRun = Doc<"savedQueryRuns">;

export interface SavedQueryAdminQuery {
  savedQueryId: Id<"savedQueries">;
  title: string;
  query: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  runCount: number;
  runsInPeriod: number;
  ranInPeriod: boolean;
}

export interface SavedQueryAdminUser {
  userId: Id<"users">;
  clerkId: string;
  name: string;
  email: string;
  savedQueryCount: number;
  savedQueriesCreatedInPeriod: number;
  totalRunCount: number;
  runsInPeriod: number;
  repeatedQueries: number;
  lastRunAt: number | null;
  queries: SavedQueryAdminQuery[];
}

export interface SavedQueryAdminSummary {
  totalSavedQueries: number;
  savedQueriesCreatedInPeriod: number;
  usersWithSavedQueries: number;
  totalRunCount: number;
  runsInPeriod: number;
  usersWithRunsInPeriod: number;
  repeatedQueries: number;
  users: SavedQueryAdminUser[];
}

function getWeekRange({
  weekFilter,
}: {
  weekFilter?: string;
}): { startMs: number; endMs: number } | null {
  if (!weekFilter) return null;
  const startMs = new Date(`${weekFilter}T00:00:00Z`).getTime();
  if (!Number.isFinite(startMs)) return null;
  return { startMs, endMs: startMs + 7 * 24 * 60 * 60 * 1000 };
}

function isInRange({
  range,
  timestamp,
}: {
  range: { startMs: number; endMs: number } | null;
  timestamp: number;
}): boolean {
  if (!range) return true;
  return timestamp >= range.startMs && timestamp < range.endMs;
}

function matchesUserFilter({
  user,
  normalizedFilter,
}: {
  user: User;
  normalizedFilter?: string;
}): boolean {
  if (!normalizedFilter) return true;
  const haystack = [user._id, user.clerkId, user.email, user.name ?? ""].join(" ").toLowerCase();
  return haystack.includes(normalizedFilter);
}

export function summarizeSavedQueryUsage({
  users,
  savedQueries,
  runs,
  userFilter,
  weekFilter,
}: {
  users: User[];
  savedQueries: SavedQuery[];
  runs: SavedQueryRun[];
  userFilter?: string;
  weekFilter?: string;
}): SavedQueryAdminSummary {
  const normalizedFilter = userFilter?.trim().toLowerCase() || undefined;
  const period = getWeekRange({ weekFilter });
  const usersById = new Map<Id<"users">, User>();
  for (const user of users) {
    usersById.set(user._id, user);
  }

  const runsBySavedQueryId = new Map<Id<"savedQueries">, number>();
  for (const run of runs) {
    if (!isInRange({ range: period, timestamp: run.timestamp })) continue;
    runsBySavedQueryId.set(run.savedQueryId, (runsBySavedQueryId.get(run.savedQueryId) ?? 0) + 1);
  }

  const byUser = new Map<Id<"users">, SavedQueryAdminUser>();

  for (const savedQuery of savedQueries) {
    const user = usersById.get(savedQuery.userId);
    if (!user) continue;
    if (!matchesUserFilter({ user, normalizedFilter })) continue;

    const runsInPeriod = runsBySavedQueryId.get(savedQuery._id) ?? 0;
    const runCount = savedQuery.runCount ?? (savedQuery.lastRunAt ? 1 : 0);
    const lastRunAt = savedQuery.lastRunAt ?? null;
    const createdInPeriod = isInRange({ range: period, timestamp: savedQuery.createdAt });
    const shouldIncludeQuery = !period || createdInPeriod || runsInPeriod > 0;
    if (!shouldIncludeQuery) continue;

    const existing = byUser.get(savedQuery.userId) ?? {
      userId: user._id,
      clerkId: user.clerkId,
      name: getDisplayName({ user }),
      email: user.email,
      savedQueryCount: 0,
      savedQueriesCreatedInPeriod: 0,
      totalRunCount: 0,
      runsInPeriod: 0,
      repeatedQueries: 0,
      lastRunAt: null,
      queries: [],
    };

    existing.savedQueryCount += 1;
    existing.savedQueriesCreatedInPeriod += createdInPeriod ? 1 : 0;
    existing.totalRunCount += runCount;
    existing.runsInPeriod += runsInPeriod;
    existing.repeatedQueries += runCount > 1 ? 1 : 0;
    if (lastRunAt !== null) {
      existing.lastRunAt = existing.lastRunAt === null ? lastRunAt : Math.max(existing.lastRunAt, lastRunAt);
    }
    existing.queries.push({
      savedQueryId: savedQuery._id,
      title: savedQuery.title,
      query: savedQuery.query,
      createdAt: savedQuery.createdAt,
      updatedAt: savedQuery.updatedAt,
      lastRunAt,
      runCount,
      runsInPeriod,
      ranInPeriod: runsInPeriod > 0,
    });
    byUser.set(savedQuery.userId, existing);
  }

  const usersSummary = Array.from(byUser.values())
    .map((user) => ({
      ...user,
      queries: user.queries.sort((a, b) => {
        if (b.runsInPeriod !== a.runsInPeriod) return b.runsInPeriod - a.runsInPeriod;
        if (b.runCount !== a.runCount) return b.runCount - a.runCount;
        return b.updatedAt - a.updatedAt;
      }),
    }))
    .sort((a, b) => {
      if (b.runsInPeriod !== a.runsInPeriod) return b.runsInPeriod - a.runsInPeriod;
      if (b.totalRunCount !== a.totalRunCount) return b.totalRunCount - a.totalRunCount;
      if (b.savedQueryCount !== a.savedQueryCount) return b.savedQueryCount - a.savedQueryCount;
      return (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0);
    });

  return {
    totalSavedQueries: usersSummary.reduce((total, user) => total + user.savedQueryCount, 0),
    savedQueriesCreatedInPeriod: usersSummary.reduce((total, user) => total + user.savedQueriesCreatedInPeriod, 0),
    usersWithSavedQueries: usersSummary.length,
    totalRunCount: usersSummary.reduce((total, user) => total + user.totalRunCount, 0),
    runsInPeriod: usersSummary.reduce((total, user) => total + user.runsInPeriod, 0),
    usersWithRunsInPeriod: usersSummary.filter((user) => user.runsInPeriod > 0).length,
    repeatedQueries: usersSummary.reduce((total, user) => total + user.repeatedQueries, 0),
    users: usersSummary,
  };
}
