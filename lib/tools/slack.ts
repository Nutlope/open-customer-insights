import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import type { SlackChannelHistoryResult, SlackSearchResult, SlackThreadResult } from "../convex/slack";
import { capToolOutput, previewText, type ToolOutputOptions } from "./output";

export const LIST_SLACK_CHANNELS_TOOL_DESCRIPTION = `List Together Slack channels that the Slack bot is already a member of.
Use this before search_slack when you need to discover likely customer/prospect channels, for example sales-revolut or sales-prosus.
This only lists joined channels, not every Slack channel in the workspace.`;

export const listSlackChannelsInputSchema = z.object({
  query: z.string().optional().describe("Optional channel-name filter, e.g. revolut, sales, higgsfield"),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum channels to return, default 50"),
});

export const SLACK_SEARCH_TOOL_DESCRIPTION = `Search Together Slack channels that the Slack bot is already a member of.
Use this for live Slack context about prospects, customers, deals, support escalations, commercial motion, and internal discussion.
This does not search all Slack. It only scans recent messages in joined channels, bounded by messagesPerChannel and maxMatches.

Prefer companyName/domain for company-specific questions. Use query for a concrete phrase like "pricing", "legal", "provisioned throughput", "latency", or "GPU".
Returned results include [id:slack:<channelId>:<threadTs>] tags. Use read_slack_thread to fetch the full thread.`;

export const GET_SLACK_CHANNEL_HISTORY_TOOL_DESCRIPTION = `Read recent messages from one joined Slack channel.
Use this when the user asks for latest/last/recent messages in a specific channel. This does not require a search query.
Pass channelName like "devrel-team" or channelId from list_slack_channels.`;

export const slackSearchInputSchema = z.object({
  companyName: z.string().optional().describe("Company/prospect name, e.g. Revolut"),
  domain: z.string().optional().describe("Company domain, e.g. revolut.com"),
  query: z.string().optional().describe("Optional concrete Slack search term to match in recent joined-channel messages"),
  channelName: z.string().optional().describe("Optional channel name filter, without requiring #, e.g. sales-revolut"),
  messagesPerChannel: z.number().int().min(1).max(200).optional().describe("Recent messages to inspect per joined channel, default 100, max 200"),
  maxMatches: z.number().int().min(1).max(50).optional().describe("Maximum Slack matches to return, default 20, max 50"),
});

export const getSlackChannelHistoryInputSchema = z.object({
  channelName: z.string().optional().describe("Slack channel name, e.g. devrel-team or #devrel-team"),
  channelId: z.string().optional().describe("Slack channel ID from list_slack_channels"),
  limit: z.number().int().min(1).max(100).optional().describe("Number of recent channel messages to fetch, default 20, max 100"),
});

export const GET_SLACK_THREAD_TOOL_DESCRIPTION = `Read a Slack thread returned by search_slack or read_slack_channel.
Pass the [id:slack:<channelId>:<threadTs>] tag exactly as returned by search_slack.`;

export const getSlackThreadInputSchema = z.object({
  id: z.string().describe('Slack source id from search_slack, e.g. "slack:C123:1712345678.000000"'),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum messages in the thread, default 100"),
});

type SlackSearchToolParams = {
  convex: ConvexHttpClient;
  clerkId?: string;
  serverSecret?: string;
  companyName?: string;
  domain?: string;
  query?: string;
  channelName?: string;
  messagesPerChannel?: number;
  maxMatches?: number;
  outputOptions?: ToolOutputOptions;
};

type SlackChannelsToolParams = {
  convex: ConvexHttpClient;
  clerkId?: string;
  serverSecret?: string;
  query?: string;
  limit?: number;
  outputOptions?: ToolOutputOptions;
};

type SlackThreadToolParams = {
  convex: ConvexHttpClient;
  clerkId?: string;
  serverSecret?: string;
  id: string;
  limit?: number;
  outputOptions?: ToolOutputOptions;
};

type SlackChannelHistoryToolParams = {
  convex: ConvexHttpClient;
  clerkId?: string;
  serverSecret?: string;
  channelName?: string;
  channelId?: string;
  limit?: number;
  outputOptions?: ToolOutputOptions;
};

type SlackChannelToolResult = {
  id: string;
  name?: string;
  isPrivate?: boolean;
  memberCount?: number;
};

function parseSlackId({ id }: { id: string }): { channelId: string; threadTs: string } {
  const match = id.match(/^slack:([^:]+):(.+)$/);
  if (!match) throw new Error('Slack id must look like "slack:C123:1712345678.000000".');
  return {
    channelId: match[1]!,
    threadTs: match[2]!,
  };
}

export async function searchSlackTool({
  convex,
  clerkId,
  serverSecret,
  companyName,
  domain,
  query,
  channelName,
  messagesPerChannel,
  maxMatches,
  outputOptions,
}: SlackSearchToolParams): Promise<string> {
  const result = await convex.action(api.slack.searchJoinedChannels, {
    clerkId,
    serverSecret,
    companyName,
    domain,
    query,
    channelName,
    messagesPerChannel,
    maxMatches,
  }) as SlackSearchResult;

  if (result.matches.length === 0) {
    return `No Slack matches found in joined channels.\n\nSearched ${result.searchedChannelCount} joined channel${result.searchedChannelCount === 1 ? "" : "s"} for: ${result.terms.join(", ") || "no terms"}.`;
  }

  const body = result.matches.map((match, index) => {
    const channel = match.channelName ? `#${match.channelName}` : match.channelId;
    const date = match.timestamp ? ` — ${new Date(match.timestamp).toLocaleDateString()}` : "";
    const terms = match.matchedTerms.length ? ` matches:${match.matchedTerms.join(",")}` : "";
    const author = match.authorName ? ` by ${match.authorName}` : "";
    return `${index + 1}. [Slack] ${channel}${author}${date}${terms}\n${previewText({ text: match.text, length: 300 })}\n[id:${match.id}]`;
  }).join("\n\n---\n\n");

  return capToolOutput({
    text: `${body}\n\n[Searched ${result.searchedChannelCount} joined Slack channel${result.searchedChannelCount === 1 ? "" : "s"}. Slack coverage is limited to channels the bot is already in.]`,
    label: "Slack search output",
    guidance: "Use a narrower channel, company, or query.",
    outputOptions,
  });
}

export async function listSlackChannelsTool({
  convex,
  clerkId,
  serverSecret,
  query,
  limit,
  outputOptions,
}: SlackChannelsToolParams): Promise<string> {
  const channels = await convex.action(api.slack.listJoinedChannels, {
    clerkId,
    serverSecret,
    query,
    limit,
  }) as SlackChannelToolResult[];

  if (channels.length === 0) {
    return query ? `No joined Slack channels matched "${query}".` : "No joined Slack channels found.";
  }

  const output = channels.map((channel, index) => {
    const privacy = channel.isPrivate ? "private" : "public";
    const members = channel.memberCount === undefined ? "" : ` · ${channel.memberCount} members`;
    return `${index + 1}. #${channel.name ?? channel.id} (${privacy}${members})\nchannelId: ${channel.id}`;
  }).join("\n\n");
  return capToolOutput({
    text: output,
    label: "Slack channel list",
    guidance: "Use a channel-name filter or smaller limit.",
    outputOptions,
  });
}

export async function getSlackChannelHistoryTool({
  convex,
  clerkId,
  serverSecret,
  channelName,
  channelId,
  limit,
  outputOptions,
}: SlackChannelHistoryToolParams): Promise<string> {
  const result = await convex.action(api.slack.getChannelHistory, {
    clerkId,
    serverSecret,
    channelName,
    channelId,
    limit,
  }) as SlackChannelHistoryResult;

  if (result.messages.length === 0) {
    return `No recent Slack messages found in ${result.channelName ? `#${result.channelName}` : result.channelId}.`;
  }

  const channel = result.channelName ? `#${result.channelName}` : result.channelId;
  const output = result.messages.map((message, index) => {
    const speaker = message.authorName ?? message.username ?? message.user ?? message.botId ?? "unknown";
    const date = message.timestamp ? ` — ${new Date(message.timestamp).toLocaleString()}` : "";
    const threadId = message.ts ? `\n[id:slack:${result.channelId}:${message.ts}]` : "";
    return `${index + 1}. [Slack] ${channel} by ${speaker}${date}\n${previewText({ text: message.text, length: 500 })}${threadId}`;
  }).join("\n\n---\n\n");
  return capToolOutput({
    text: output,
    label: "Slack channel history",
    guidance: "Use a smaller limit or read a specific thread.",
    outputOptions,
  });
}

export async function getSlackThreadTool({
  convex,
  clerkId,
  serverSecret,
  id,
  limit,
  outputOptions,
}: SlackThreadToolParams): Promise<string> {
  const { channelId, threadTs } = parseSlackId({ id });
  const thread = await convex.action(api.slack.getThread, {
    clerkId,
    serverSecret,
    channelId,
    threadTs,
    limit,
  }) as SlackThreadResult;

  if (thread.messages.length === 0) return "No Slack thread messages found.";

  const output = thread.messages.map((message, index) => {
    const speaker = message.authorName ?? message.username ?? message.user ?? message.botId ?? "unknown";
    const date = message.timestamp ? ` — ${new Date(message.timestamp).toLocaleString()}` : "";
    return `${index + 1}. ${speaker}${date}\n${message.text}`;
  }).join("\n\n");
  return capToolOutput({
    text: output,
    label: "Slack thread",
    guidance: "Use a smaller limit or ask about a narrower part of the thread.",
    outputOptions,
  });
}
