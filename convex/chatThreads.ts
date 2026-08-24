import {
  Agent,
  abortStream,
  createThread,
  listStreams,
  listUIMessages,
  saveMessage,
  syncStreams,
  updateThreadMetadata,
  vStreamArgs,
} from "@convex-dev/agent";
import { togetherai } from "@ai-sdk/togetherai";
import { stepCountIs, tool, type ToolSet } from "ai";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { ConvexHttpClient } from "convex/browser";
import { api, components, internal } from "./_generated/api";
import { action, internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  assertThreadAccess,
  getCurrentUser,
  titleFromPrompt,
} from "../lib/convex/chatThreads";
import { getChatModelLabel, isChatModelId } from "../lib/chat/models";
import { resolveBestChatModelId } from "../lib/chat/router";
import { SEARCH_TOOL_USAGE_GUIDANCE } from "../lib/tools/definitions";
import { WEB_APP_TOOL_OUTPUT_OPTIONS } from "../lib/tools/output";
import { getTool } from "../lib/tools/get";
import { listCompaniesTool } from "../lib/tools/companies";
import {
  getSlackChannelHistoryTool,
  getSlackThreadTool,
  listSlackChannelsTool,
  searchSlackTool,
} from "../lib/tools/slack";
import { searchTool } from "../lib/tools/search";
import { toolCatalog } from "../lib/tools/catalog";

const CHAT_MAX_OUTPUT_TOKENS = 8192;
const WEB_APP_QUERY_CLARIFICATION_GUIDANCE = `For broad inventory, counting, or filtered-list questions in the web app, do not turn the user's full request into a semantic search query.
Examples include "list every unique customer across all calls", "customers last month who are customers and complained about voice", or requests with multiple filters.
If the request is missing a timeframe, customer status, source, or concrete topic filter, ask one concise clarification before searching.
Use list_companies for structured customer/prospect/company inventory.
Use search only for concrete evidence phrases, and use no query when browsing calls/tickets by source/date.`;

function systemPrompt(): string {
  return `You are a helpful assistant that searches call transcripts, support tickets, and bounded Slack context.
Use search to find relevant call/ticket content, then get to fetch full transcripts or message threads when needed.
Use list_slack_channels to discover Slack channels the bot can read.
Use read_slack_channel for latest/recent messages in a specific Slack channel.
Use search_slack for live Slack context about companies or prospects, then read_slack_thread to fetch full Slack threads.
Always cite specific results, dates, and company names. Be concise but thorough.
Today's date is ${new Date().toISOString().split("T")[0]}.

source values: "calls" = calls only, "tickets" = tickets only, "all" = both (default — always use this unless the user specifies otherwise).

${SEARCH_TOOL_USAGE_GUIDANCE}

${WEB_APP_QUERY_CLARIFICATION_GUIDANCE}

Use search/get for concrete evidence and exact customer wording.
When the user asks for calls with a named company/person/account, search calls using the short exact name first, then fetch the matching call ids with get. Do not conclude there are no direct calls from list_companies alone.
If Slack mentions a call id, fetch that call id with get before summarizing it.

Format answers as Markdown. Never use Markdown tables.
The chat panel is narrow, especially on mobile:
- Use short paragraphs for context.
- Use bullet lists for grouped highlights, issues, takeaways, and examples.
- Use numbered lists only when order or priority matters.
- Use bold labels inside bullets when that improves scanability.`;
}

function toolClient({ ctx }: { ctx: ActionCtx }): ConvexHttpClient {
  return {
    query: ctx.runQuery.bind(ctx),
    action: ctx.runAction.bind(ctx),
  } as unknown as ConvexHttpClient;
}

function buildChatTools({
  ctx,
  clerkId,
  serverSecret,
}: {
  ctx: ActionCtx;
  clerkId: string;
  serverSecret?: string;
}) {
  const convex = toolClient({ ctx });
  return {
    [toolCatalog.search.name]: tool({
      description: toolCatalog.search.description,
      inputSchema: toolCatalog.search.inputSchema,
      execute: async ({ query, source, from, to, limit, offset }) => {
        return searchTool({ convex, clerkId, serverSecret, query, source, limit, offset, fromDate: from, toDate: to, outputOptions: WEB_APP_TOOL_OUTPUT_OPTIONS });
      },
    }),
    [toolCatalog.get.name]: tool({
      description: toolCatalog.get.description,
      inputSchema: toolCatalog.get.inputSchema,
      execute: async ({ id }) => {
        return getTool({ convex, clerkId, serverSecret, id, outputOptions: WEB_APP_TOOL_OUTPUT_OPTIONS });
      },
    }),
    [toolCatalog.listSlackChannels.name]: tool({
      description: toolCatalog.listSlackChannels.description,
      inputSchema: toolCatalog.listSlackChannels.inputSchema,
      execute: async ({ query, limit }) => {
        return listSlackChannelsTool({ convex, clerkId, serverSecret, query, limit, outputOptions: WEB_APP_TOOL_OUTPUT_OPTIONS });
      },
    }),
    [toolCatalog.searchSlack.name]: tool({
      description: toolCatalog.searchSlack.description,
      inputSchema: toolCatalog.searchSlack.inputSchema,
      execute: async ({ companyName, domain, query, channelName, messagesPerChannel, maxMatches }) => {
        return searchSlackTool({
          convex,
          clerkId,
          serverSecret,
          companyName,
          domain,
          query,
          channelName,
          messagesPerChannel,
          maxMatches,
          outputOptions: WEB_APP_TOOL_OUTPUT_OPTIONS,
        });
      },
    }),
    [toolCatalog.readSlackChannel.name]: tool({
      description: toolCatalog.readSlackChannel.description,
      inputSchema: toolCatalog.readSlackChannel.inputSchema,
      execute: async ({ channelName, channelId, limit }) => {
        return getSlackChannelHistoryTool({ convex, clerkId, serverSecret, channelName, channelId, limit, outputOptions: WEB_APP_TOOL_OUTPUT_OPTIONS });
      },
    }),
    [toolCatalog.readSlackThread.name]: tool({
      description: toolCatalog.readSlackThread.description,
      inputSchema: toolCatalog.readSlackThread.inputSchema,
      execute: async ({ id, limit }) => {
        return getSlackThreadTool({ convex, clerkId, serverSecret, id, limit, outputOptions: WEB_APP_TOOL_OUTPUT_OPTIONS });
      },
    }),
    [toolCatalog.listCompanies.name]: tool({
      description: toolCatalog.listCompanies.description,
      inputSchema: toolCatalog.listCompanies.inputSchema,
      execute: async ({ search, status, limit }) => {
        return listCompaniesTool({ convex, serverSecret, search, status, limit, outputOptions: WEB_APP_TOOL_OUTPUT_OPTIONS });
      },
    }),
  };
}

type ResolvedChatModel = {
  modelId: string;
  label: string;
};

type ChatUiMessageWithResolvedModel = Awaited<ReturnType<typeof listUIMessages>>["page"][number] & {
  resolvedModel?: ResolvedChatModel;
};

async function resolvedModelsByOrder({
  ctx,
  threadId,
}: {
  ctx: QueryCtx;
  threadId: string;
}): Promise<Map<number, ResolvedChatModel>> {
  const messages = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId,
    order: "asc",
    statuses: ["pending", "success"],
    paginationOpts: {
      cursor: null,
      numItems: 1000,
    },
  });
  const byOrder = new Map<number, ResolvedChatModel>();
  for (const message of messages.page) {
    if (!message.model || message.message?.role !== "assistant" || message.tool) continue;
    byOrder.set(message.order, {
      modelId: message.model,
      label: getChatModelLabel({ modelId: message.model }),
    });
  }
  return byOrder;
}

async function resolveModelId({ model }: { model?: string }): Promise<string> {
  if (isChatModelId(model)) return model;
  return resolveBestChatModelId();
}

export const create = mutation({
  args: {
    initialPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ threadId: string }> => {
    const currentUser = await getCurrentUser({ ctx });
    const threadId = await createThread(ctx, components.agent, {
      userId: currentUser.userId,
      title: titleFromPrompt({ prompt: args.initialPrompt ?? "" }),
    });
    return { threadId };
  },
});

export const listMine = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser({ ctx });
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: currentUser.userId,
      order: "desc",
      paginationOpts: {
        cursor: null,
        numItems: Math.max(1, Math.min(args.limit ?? 20, 50)),
      },
    });
    return threads.page
      .filter((thread) => thread.status === "active")
      .map((thread) => ({
        threadId: thread._id,
        title: thread.title ?? "New chat",
        summary: thread.summary,
        createdAt: thread._creationTime,
      }));
  },
});

export const get = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const { thread } = await assertThreadAccess({ ctx, threadId: args.threadId });
    return {
      threadId: thread._id,
      title: thread.title ?? "New chat",
      summary: thread.summary,
      createdAt: thread._creationTime,
      ownerUserId: thread.userId,
    };
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    await assertThreadAccess({ ctx, threadId: args.threadId });
    const [paginated, streams, modelByOrder] = await Promise.all([
      listUIMessages(ctx, components.agent, {
        threadId: args.threadId,
        paginationOpts: args.paginationOpts,
      }),
      syncStreams(ctx, components.agent, {
        threadId: args.threadId,
        streamArgs: args.streamArgs,
      }),
      resolvedModelsByOrder({ ctx, threadId: args.threadId }),
    ]);
    return {
      ...paginated,
      page: paginated.page.map((message): ChatUiMessageWithResolvedModel => ({
        ...message,
        ...(message.role === "assistant" && modelByOrder.has(message.order)
          ? { resolvedModel: modelByOrder.get(message.order)! }
          : {}),
      })),
      streams,
    };
  },
});

export const submit = action({
  args: {
    threadId: v.optional(v.string()),
    text: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ threadId: string; messageId: string }> => {
    const text = args.text.trim();
    if (!text) throw new Error("Message is empty");

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const limitResult = await ctx.runAction(api.users.checkChatRateLimit, {});
    if (!limitResult.ok) throw new Error(limitResult.error);
    const userId = limitResult.userId as Id<"users">;

    return await ctx.runMutation(internal.chatThreads.submitMessage, {
      clerkId: identity.subject,
      model: args.model,
      text,
      threadId: args.threadId,
      userId,
    });
  },
});

export const submitMessage = internalMutation({
  args: {
    clerkId: v.string(),
    model: v.optional(v.string()),
    text: v.string(),
    threadId: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ threadId: string; messageId: string }> => {
    let threadId = args.threadId;
    if (threadId) {
      const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId });
      if (!thread) throw new Error("Thread not found");
      if (thread.userId !== args.userId) throw new Error("Thread not found");
    } else {
      threadId = await createThread(ctx, components.agent, {
        userId: args.userId,
        title: titleFromPrompt({ prompt: args.text }),
      });
    }

    const saved = await saveMessage(ctx, components.agent, {
      threadId,
      userId: args.userId,
      prompt: args.text,
    });

    await ctx.db.insert("apiKeyUsage", {
      userId: args.userId,
      endpoint: "chat",
      timestamp: Date.now(),
    });
    await ctx.db.insert("userQueries", {
      userId: args.userId,
      channel: "chat",
      query: args.text,
      threadId,
      timestamp: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.chatThreads.generateReply, {
      clerkId: args.clerkId,
      messageId: saved.messageId,
      model: args.model,
      threadId,
      userId: args.userId,
    });

    return { threadId, messageId: saved.messageId };
  },
});

export const generateReply = internalAction({
  args: {
    clerkId: v.string(),
    messageId: v.string(),
    model: v.optional(v.string()),
    threadId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<void> => {
    const modelId = await resolveModelId({ model: args.model });
    const serverSecret = process.env.INTERNAL_CONVEX_SECRET;
    const agent = new Agent(components.agent, {
      name: "Customer Insights",
      languageModel: togetherai(modelId),
      instructions: systemPrompt(),
      stopWhen: stepCountIs(20),
      tools: buildChatTools({
        ctx,
        clerkId: args.clerkId,
        serverSecret,
      }) as ToolSet,
    });

    await agent.streamText(
      ctx,
      {
        threadId: args.threadId,
        userId: args.userId,
      },
      {
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        promptMessageId: args.messageId,
      },
      {
        saveStreamDeltas: true,
      }
    );
  },
});

export const saveUserMessage = mutation({
  args: {
    threadId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<{ messageId: string }> => {
    const { userId, thread } = await assertThreadAccess({ ctx, threadId: args.threadId });
    const text = args.text.trim();
    if (!text) throw new Error("Message is empty");
    if (!thread.title || thread.title === "New chat") {
      await updateThreadMetadata(ctx, components.agent, {
        threadId: args.threadId,
        patch: { title: titleFromPrompt({ prompt: text }) },
      });
    }
    return await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      userId,
      prompt: text,
    });
  },
});

export const saveAssistantMessage = mutation({
  args: {
    threadId: v.string(),
    text: v.string(),
    model: v.optional(v.string()),
    toolCalls: v.optional(v.array(v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      inputJson: v.optional(v.string()),
      outputPreview: v.optional(v.string()),
      isError: v.optional(v.boolean()),
    }))),
  },
  handler: async (ctx, args): Promise<{ messageId: string } | null> => {
    await assertThreadAccess({ ctx, threadId: args.threadId });
    const text = args.text.trim();
    const toolCalls = args.toolCalls ?? [];
    if (!text && toolCalls.length === 0) return null;
    const saved = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      agentName: "Customer Insights",
      message: {
        role: "assistant",
        content: text,
      },
      metadata: {
        model: args.model,
      },
    });
    await Promise.all(toolCalls.map((toolCall, index) =>
      ctx.db.insert("chatToolCalls", {
        threadId: args.threadId,
        messageId: saved.messageId,
        order: index,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        inputJson: toolCall.inputJson,
        outputPreview: toolCall.outputPreview,
        isError: toolCall.isError,
        createdAt: Date.now(),
      })
    ));
    return saved;
  },
});

export const archive = mutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await assertThreadAccess({ ctx, threadId: args.threadId });
    await updateThreadMetadata(ctx, components.agent, {
      threadId: args.threadId,
      patch: { status: "archived" },
    });
  },
});

export const abort = mutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await assertThreadAccess({ ctx, threadId: args.threadId });
    const streams = await listStreams(ctx, components.agent, {
      threadId: args.threadId,
      includeStatuses: ["streaming"],
    });
    const latest = streams.sort((first, second) => second.order - first.order).at(0);
    if (!latest) return;
    await abortStream(ctx, components.agent, {
      streamId: latest.streamId,
      reason: "User stopped the response",
    });
  },
});
