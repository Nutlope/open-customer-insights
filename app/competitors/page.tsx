import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { COMPETITORS } from "@/lib/competitors";
import { CompetitorsClient } from "./CompetitorsClient";

const RANGE_DAYS: Record<string, number> = { week: 7, month: 30, quarter: 90, halfyear: 180, year: 365 };

function getFrom(range: string): string {
  return new Date(Date.now() - (RANGE_DAYS[range] ?? 7) * 86_400_000).toISOString();
}

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string }>;
}) {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/");
  const token = await getToken({ template: "convex" });
  if (!token) redirect("/");

  const params = await searchParams;
  const range = (params?.range ?? "week") as "week" | "month" | "quarter" | "halfyear" | "year";
  const from = getFrom(range);

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);

  type LeaderboardEntry = {
    name: string;
    domain: string;
    calls: number;
    tickets: number;
    total: number;
    lastSeen: string | null;
  };

  const leaderboard: LeaderboardEntry[] = await convex.action(api.competitors.getCompetitorLeaderboard, { from, range });

  // Merge with full COMPETITORS list so every competitor appears even with 0 mentions
  const countMap = new Map(leaderboard.map((e) => [e.name, e]));
  const rows = COMPETITORS.map((c) => {
    const e = countMap.get(c.name);
    return {
      name: c.name,
      domain: c.domain,
      calls: e?.calls ?? 0,
      tickets: e?.tickets ?? 0,
      total: e?.total ?? 0,
      lastSeen: e?.lastSeen ?? null,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const totalMentions = leaderboard.reduce((s, r) => s + r.total, 0);
  const totalCalls = leaderboard.reduce((s, r) => s + r.calls, 0);
  const totalTickets = leaderboard.reduce((s, r) => s + r.tickets, 0);
  const detectedCount = leaderboard.length;

  return (
    <CompetitorsClient
      initialRows={rows}
      initialRange={range}
      totalMentions={totalMentions}
      totalCalls={totalCalls}
      totalTickets={totalTickets}
      detectedCount={detectedCount}
      competitorCount={COMPETITORS.length}
    />
  );
}
