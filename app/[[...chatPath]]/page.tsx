import { Suspense } from "react";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { api } from "@/convex/_generated/api";
import ClientAuthGate from "@/app/components/ClientAuthGate";

type ChatPathParams = {
  chatPath?: string[];
};

type Stats = {
  callsCount: number;
  issuesCount: number;
  chunksTotal: number;
  chunksEmbedded: number;
  slackChannelsCount?: number;
  companiesCount?: number;
  recentCalls: Array<{ title: string; date: string }>;
  recentTickets: Array<{ title: string; date: string }>;
  recentSlackChannels?: string[];
  recentCompanies?: string[];
};

function getThreadIdFromPath({ chatPath }: ChatPathParams): string | undefined {
  if (!chatPath) return undefined;
  if (chatPath.length === 1 && chatPath[0] === "chat") return undefined;
  if (chatPath.length === 2 && chatPath[0] === "chat" && chatPath[1]) {
    return chatPath[1];
  }
  notFound();
}

async function getStats(): Promise<Stats | null> {
  const { userId, getToken } = await auth();

  try {
    const token = userId ? await getToken({ template: "convex" }) : null;
    if (!token) throw new Error("Unauthenticated");
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(token);
    const [dataStats, slackStats, companyStats, topCompanies] = await Promise.all([
      convex.query(api.queries.getStats),
      convex.action(api.slack.getJoinedChannelStats, {}).catch(() => null),
      convex.query(api.companies.getCompanyStats).catch(() => null),
      convex.query(api.companies.listCompanies, { status: "customer", limit: 5 }).catch(() => null),
    ]);
    return {
      ...dataStats,
      slackChannelsCount: slackStats?.joinedChannelCount,
      recentSlackChannels: slackStats?.channelNames,
      companiesCount: companyStats?.total,
      recentCompanies: topCompanies?.map((company) => company.name) ?? [],
    };
  } catch {
    return null;
  }
}

export default async function Home({
  params,
}: {
  params: Promise<ChatPathParams>;
}) {
  const threadId = getThreadIdFromPath(await params);
  const stats = await getStats();

  return (
    <Suspense>
      <ClientAuthGate stats={stats} threadId={threadId} />
    </Suspense>
  );
}
