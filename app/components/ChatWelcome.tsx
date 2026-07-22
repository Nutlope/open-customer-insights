"use client";

import FeatureUpdatesStack from "./FeatureUpdatesStack";

export type ChatWelcomeStats = {
  callsCount: number;
  issuesCount: number;
  dailyInsightsCount: number;
  chunksTotal?: number;
  chunksEmbedded?: number;
  slackChannelsCount?: number;
  companiesCount?: number;
  recentCalls: Array<{ title: string; date: string }>;
  recentTickets: Array<{ title: string; date: string }>;
  recentDailyInsights?: Array<{ title: string; date: string }>;
  recentSlackChannels?: string[];
  recentCompanies?: string[];
};

export default function ChatWelcome({
  firstName,
  isUserLoaded,
}: {
  firstName: string | null;
  isUserLoaded: boolean;
  stats?: ChatWelcomeStats | null;
}) {
  return (
    <div className="flex items-center justify-center text-center">
      <div className="mx-auto w-full max-w-[920px] px-4">
        <h3 className="text-balance text-2xl font-semibold leading-tight tracking-normal text-zinc-950 md:text-[1.9rem]">
          {isUserLoaded ? (
            <>Welcome{firstName ? `, ${firstName}` : ""}</>
          ) : (
            <span className="inline-flex items-center gap-2">
              Welcome
              <span className="h-7 w-24 animate-pulse rounded-md bg-zinc-100 align-middle md:h-8" />
            </span>
          )}
        </h3>
        <p className="mx-auto mt-2.5 max-w-[40rem] text-pretty text-sm leading-6 text-zinc-500 md:mt-3">
          Ask any question about daily insights, customer calls, tickets, and Slack threads.
        </p>
        <FeatureUpdatesStack />
      </div>
    </div>
  );
}
