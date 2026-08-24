"use client";

import FeatureUpdatesStack from "./FeatureUpdatesStack";

export type ChatWelcomeStats = {
  callsCount: number;
  issuesCount: number;
  chunksTotal?: number;
  chunksEmbedded?: number;
  slackChannelsCount?: number;
  companiesCount?: number;
  recentCalls: Array<{ title: string; date: string }>;
  recentTickets: Array<{ title: string; date: string }>;
  recentSlackChannels?: string[];
  recentCompanies?: string[];
};

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function ChatWelcome({
  firstName,
  isUserLoaded,
}: {
  firstName: string | null;
  isUserLoaded: boolean;
  stats?: ChatWelcomeStats | null;
}) {
  const greeting = greetingForNow();
  return (
    <div className="flex items-center justify-center text-center">
      <div className="mx-auto w-full max-w-[920px] px-4">
        <h3 className="text-balance text-2xl font-semibold leading-tight tracking-normal text-zinc-950 md:text-3xl">
          {isUserLoaded ? (
            <>{greeting}{firstName ? `, ${firstName}` : ""}</>
          ) : (
            <span className="inline-flex items-center gap-2">
              {greeting}
              <span className="h-7 w-24 animate-pulse rounded-md bg-zinc-200/60 align-middle md:h-8" />
            </span>
          )}
        </h3>
        <p className="mx-auto mt-2.5 max-w-[40rem] text-pretty text-sm leading-6 text-zinc-500 md:mt-3">
          Ask any question about customer calls, support tickets, companies, and Slack threads.
        </p>
        <FeatureUpdatesStack />
      </div>
    </div>
  );
}
