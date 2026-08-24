"use client";

import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import AuthenticatedSection from "./AuthenticatedSection";
import SignInPrompt from "./SignInPrompt";

interface Stats {
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
}

interface Props {
  stats: Stats | null;
  threadId?: string;
}

export default function ClientAuthGate({
  stats,
  threadId,
}: Props) {
  const { isSignedIn, isLoaded } = useAuth();
  const searchParams = useSearchParams();
  const promptParam = searchParams.get("prompt");
  const draftPrompt = useMemo(
    () => (promptParam ? { id: promptParam, text: promptParam } : null),
    [promptParam]
  );

  return (
    <div className={`${isLoaded && isSignedIn ? "flex h-full min-h-0 flex-col overflow-hidden" : "h-full overflow-y-auto px-5 py-6"}`}>
      {!isLoaded ? null : isSignedIn ? (
        <AuthenticatedSection stats={stats} draftPrompt={draftPrompt} threadId={threadId} />
      ) : (
        <SignInPrompt />
      )}
    </div>
  );
}
