import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Ingest: fetch from APIs and store raw text every hour
crons.interval("ingest gong", { hours: 1 }, internal.ingest.runGongIngest, {});
crons.interval("ingest pylon", { hours: 4 }, internal.ingest.runPylonIngest, {});
// Pylon state sync: refresh state/priority on already-ingested tickets (list-only, stays within rate limit)
crons.interval("sync pylon ticket state", { hours: 6 }, internal.ingest.runPylonStateSync, {});
// Pylon historical sync: rotate through all history (>30 days old) in 10-day windows, one per run
crons.interval("sync pylon historical state", { hours: 12 }, internal.ingest.runPylonHistoricalRotatingSync, {});

// Embed: runs every 30 min, picks up 64 un-embedded chunks per run
crons.interval("embed pending", { minutes: 30 }, internal.embed.runEmbedPending, {});

// Slack: keep the joined-channel cache fresh (matches the 6h TTL it backstops)
crons.interval("refresh slack channel cache", { hours: 6 }, internal.slack.refreshSlackChannelCache, {});
crons.interval("refresh slack user directory", { hours: 24 }, internal.slack.refreshSlackUserDirectoryInternal, {});

// Slack mentions: once daily, scan every joined channel for new messages
// mentioning a watchlisted company (prospects + top companies by activity/revenue).
crons.daily(
  "scan slack mentions",
  { hourUTC: 7, minuteUTC: 0 },
  internal.slackMentions.scanSlackMentionsInternal,
  {}
);

// Sales wins: once daily, scan the configured Slack channel for new
// closed-won deals and import them (or queue them for manual domain review).
crons.daily(
  "scan sales-wins deals",
  { hourUTC: 7, minuteUTC: 30 },
  internal.salesWins.scanSalesWinsInternal,
  {}
);

// Weekly company reflections: Saturday 22:00 UTC, only for companies with
// activity (calls, tickets, or Slack mentions) in the preceding 7 days.
crons.weekly(
  "generate weekly company reflections",
  { dayOfWeek: "saturday", hourUTC: 22, minuteUTC: 0 },
  internal.companyTimeline.generateWeeklyReflectionsInternal,
  {}
);

// Reports: generate daily customer insights.
crons.daily(
  "generate daily report",
  { hourUTC: 8, minuteUTC: 0 },
  internal.reports.generateReport,
  { type: "daily" }
);
crons.daily(
  "refresh prospect segments",
  { hourUTC: 9, minuteUTC: 0 },
  internal.prospects.refreshDailySegmentsInternal,
  {}
);

export default crons;
