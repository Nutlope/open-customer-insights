"use client";

import { motion } from "motion/react";
import ChatDemo from "./ChatDemo";

type Stats = {
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

export default function AuthenticatedSection({
  stats,
  draftPrompt,
  threadId,
}: {
  stats?: Stats | null;
  draftPrompt?: { id: string; text: string } | null;
  threadId?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-50"
    >
      <ChatDemo compact stats={stats} draftPrompt={draftPrompt} threadId={threadId} />
    </motion.div>
  );
}
