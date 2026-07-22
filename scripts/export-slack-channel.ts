/**
 * Exports the message history (including thread replies) of a Slack channel
 * the bot has joined to a local JSON file for offline analysis.
 *
 * Resumable / incremental: if the output file already exists, only messages
 * newer than the last exported message are fetched and merged in. Re-running
 * this script later (e.g. daily) picks up just what's new since last time.
 *
 * Usage:
 *   bun run scripts/export-slack-channel.ts [channelName] [sinceDate] [outFile]
 *   bun run scripts/export-slack-channel.ts sales-wins 2024-01-01
 *
 * The channel name can also be set with SALES_WINS_SLACK_CHANNEL_NAME.
 * sinceDate defaults to 2024-01-01 and outFile defaults to
 * data/slack-exports/<channelName>.json.
 *
 * Rate limits: Slack throttles conversations.history/replies and users.info.
 * This script honors the `Retry-After` header and writes progress to disk
 * after every top-level message, so a kill/interrupt doesn't lose work —
 * just re-run the same command to continue.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import {
  cleanSlackText,
  getJoinedSlackChannels,
  resolveSlackUserFromApi,
  slackTsToIso,
  type ResolvedSlackUser,
  type SlackHistoryMessage,
} from "../lib/convex/slack";

const RATE_LIMIT_DELAY_MS = Number(process.env.SLACK_EXPORT_DELAY_MS ?? 1200);
const SKIP_SUBTYPES = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose"]);

const token = process.env.SLACK_MCP_XOXB_TOKEN;
if (!token) {
  console.error("SLACK_MCP_XOXB_TOKEN is not set.");
  process.exit(1);
}

const configuredChannel = process.argv[2] ?? process.env.SALES_WINS_SLACK_CHANNEL_NAME;
if (!configuredChannel) {
  console.error("Pass a channel name or set SALES_WINS_SLACK_CHANNEL_NAME.");
  process.exit(1);
}
const channelArg = configuredChannel.replace(/^#/, "");
const sinceArg = process.argv[3] ?? "2024-01-01";
if (!Number.isFinite(Date.parse(sinceArg))) {
  console.error(`Invalid sinceDate "${sinceArg}". Use YYYY-MM-DD.`);
  process.exit(1);
}
const defaultOldestTs = String(Date.parse(sinceArg) / 1000);
const outArg = process.argv[4] ?? `data/slack-exports/${channelArg}.json`;
const outputPath = resolve(outArg);

type ExportMessage = {
  ts: string;
  timestamp?: string;
  userId?: string;
  username?: string;
  botId?: string;
  text: string;
  rawText?: string;
  replyCount?: number;
  replies?: ExportMessage[];
};

type ExportFile = {
  channel: { id: string; name?: string };
  exportedAt: string;
  since: string;
  messageCount: number;
  messages: ExportMessage[];
};

type SlackHistoryResponse = {
  messages?: SlackHistoryMessage[];
  has_more?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function slackFetchWithRetry<T>({
  method,
  params,
}: {
  method: string;
  params: Record<string, string | number | boolean | undefined>;
}): Promise<T & { ok: boolean; error?: string; response_metadata?: { next_cursor?: string } }> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await response.json()) as T & { ok: boolean; error?: string; response_metadata?: { next_cursor?: string } };
    if (json.ok) return json;

    if (response.status === 429 || json.error === "ratelimited") {
      const retryAfterHeader = response.headers.get("retry-after");
      const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 5000 * (attempt + 1);
      console.log(`  rate limited on ${method}, waiting ${(waitMs / 1000).toFixed(0)}s (attempt ${attempt + 1})...`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Slack ${method} failed: ${json.error}`);
  }
  throw new Error(`Slack ${method} failed after retries`);
}

async function fetchAllHistory({ channelId, oldest }: { channelId: string; oldest: string }): Promise<SlackHistoryMessage[]> {
  const messages: SlackHistoryMessage[] = [];
  let cursor: string | undefined;
  let page = 0;
  do {
    page++;
    const result = await slackFetchWithRetry<SlackHistoryResponse>({
      method: "conversations.history",
      params: { channel: channelId, limit: 200, oldest, cursor },
    });
    const batch = result.messages ?? [];
    messages.push(...batch);
    cursor = result.response_metadata?.next_cursor || undefined;
    console.log(`  history page ${page}: +${batch.length} (total ${messages.length})`);
    await sleep(RATE_LIMIT_DELAY_MS);
  } while (cursor);
  return messages;
}

async function fetchAllReplies({ channelId, threadTs }: { channelId: string; threadTs: string }): Promise<SlackHistoryMessage[]> {
  const messages: SlackHistoryMessage[] = [];
  let cursor: string | undefined;
  do {
    const result = await slackFetchWithRetry<SlackHistoryResponse>({
      method: "conversations.replies",
      params: { channel: channelId, ts: threadTs, limit: 200, cursor },
    });
    messages.push(...(result.messages ?? []));
    cursor = result.response_metadata?.next_cursor || undefined;
    await sleep(RATE_LIMIT_DELAY_MS);
  } while (cursor);
  // First message is the parent itself; replies are everything else.
  return messages.filter((m) => m.ts !== threadTs);
}

function loadExisting(): ExportFile | null {
  if (!existsSync(outputPath)) return null;
  try {
    return JSON.parse(readFileSync(outputPath, "utf-8")) as ExportFile;
  } catch {
    return null;
  }
}

function writeOutput({ channel, messages }: { channel: { id: string; name?: string }; messages: ExportMessage[] }): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        channel,
        exportedAt: new Date().toISOString(),
        since: sinceArg,
        messageCount: messages.length,
        messages,
      } satisfies ExportFile,
      null,
      2
    )
  );
}

async function main() {
  console.log(`Resolving channel "#${channelArg}"...`);
  const channels = await getJoinedSlackChannels({ token: token!, channelLimit: 5000 });
  const channel = channels.find((c) => c.name === channelArg);
  if (!channel) {
    console.error(`Channel "#${channelArg}" not found among joined channels.`);
    process.exit(1);
  }

  const existing = loadExisting();
  const existingMessages = existing?.messages ?? [];
  const lastTs = existingMessages.length > 0 ? existingMessages[existingMessages.length - 1]!.ts : undefined;
  const oldest = lastTs ?? defaultOldestTs;

  if (existing) {
    console.log(`Found existing export with ${existingMessages.length} messages (last ts ${lastTs}). Fetching new messages only...`);
  } else {
    console.log(`Found #${channel.name} (${channel.id}). Fetching history since ${sinceArg}...`);
  }

  const rawMessages = (await fetchAllHistory({ channelId: channel.id, oldest }))
    .filter((m) => !m.subtype || !SKIP_SUBTYPES.has(m.subtype))
    .filter((m) => !lastTs || (m.ts && m.ts !== lastTs))
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  console.log(`Fetched ${rawMessages.length} new top-level messages. Resolving threads + users...`);

  const userCache = new Map<string, ResolvedSlackUser>();
  async function resolveUser(userId?: string): Promise<ResolvedSlackUser | undefined> {
    if (!userId) return undefined;
    const cached = userCache.get(userId);
    if (cached) return cached;
    try {
      const resolved = await resolveSlackUserFromApi({ token: token!, userId });
      userCache.set(userId, resolved);
      await sleep(RATE_LIMIT_DELAY_MS);
      return resolved;
    } catch {
      return undefined;
    }
  }

  function toExportMessage({ message, resolved }: { message: SlackHistoryMessage; resolved?: ResolvedSlackUser }): ExportMessage {
    return {
      ts: message.ts ?? "",
      timestamp: slackTsToIso({ ts: message.ts }),
      userId: message.user,
      username: resolved?.username ?? message.username,
      botId: message.bot_id,
      text: cleanSlackText({ text: message.text }),
      rawText: message.text,
    };
  }

  const allMessages: ExportMessage[] = [...existingMessages];

  for (let i = 0; i < rawMessages.length; i++) {
    const message = rawMessages[i]!;
    const resolved = await resolveUser(message.user);
    const exportMsg = toExportMessage({ message, resolved });

    if ((message.reply_count ?? 0) > 0 && message.ts) {
      const replyMessages = await fetchAllReplies({ channelId: channel.id, threadTs: message.ts });
      const replies: ExportMessage[] = [];
      for (const reply of replyMessages) {
        const replyResolved = await resolveUser(reply.user);
        replies.push(toExportMessage({ message: reply, resolved: replyResolved }));
      }
      exportMsg.replyCount = message.reply_count;
      exportMsg.replies = replies;
    }

    allMessages.push(exportMsg);
    writeOutput({ channel: { id: channel.id, name: channel.name }, messages: allMessages });
    console.log(`  [${i + 1}/${rawMessages.length}] ${exportMsg.timestamp} ${exportMsg.username ?? exportMsg.userId ?? "?"} (saved)`);
  }

  console.log(`\nDone. ${allMessages.length} total messages in ${outputPath} (${rawMessages.length} new).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
