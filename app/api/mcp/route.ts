import { AsyncLocalStorage } from "async_hooks";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { ConvexHttpClient } from "convex/browser";
import { auth } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { searchTool } from "@/lib/tools/search";
import { getTool } from "@/lib/tools/get";
import { listCompaniesTool } from "@/lib/tools/companies";
import {
  getSlackChannelHistoryTool,
  getSlackThreadTool,
  listSlackChannelsTool,
  searchSlackTool,
} from "@/lib/tools/slack";
import { toolCatalog } from "@/lib/tools/catalog";
import { APP_URL, MCP_SERVER_NAME } from "@/lib/constants";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const serverSecret = process.env.INTERNAL_CONVEX_SECRET;

const clerkIdStore = new AsyncLocalStorage<string>();

const handler = createMcpHandler(
  (server) => {
    server.registerTool(toolCatalog.search.name, {
      description: toolCatalog.search.description,
      inputSchema: toolCatalog.search.inputSchema.shape,
    }, async ({ query, source, from, to, limit, offset }) => {
      const clerkId = clerkIdStore.getStore() ?? "";
      if (query?.trim()) {
        convex
          .mutation(api.users.recordUserQueryByClerkId, {
            clerkId,
            serverSecret,
            channel: "mcp",
            query,
            source,
            fromDate: from,
            toDate: to,
            limit,
          })
          .catch(() => {});
      }
      const text = await searchTool({ convex, clerkId, serverSecret, query, source, limit, offset, fromDate: from, toDate: to });
      return { content: [{ type: "text", text }] };
    });

    server.registerTool(toolCatalog.get.name, {
      description: toolCatalog.get.description,
      inputSchema: toolCatalog.get.inputSchema.shape,
    }, async ({ id }) => {
      const clerkId = clerkIdStore.getStore() ?? "";
      const text = await getTool({ convex, clerkId, serverSecret, id });
      return { content: [{ type: "text", text }] };
    });

    server.registerTool(toolCatalog.searchSlack.name, {
      description: toolCatalog.searchSlack.description,
      inputSchema: toolCatalog.searchSlack.inputSchema.shape,
    }, async ({ companyName, domain, query, channelName, messagesPerChannel, maxMatches }) => {
      const clerkId = clerkIdStore.getStore() ?? "";
      const text = await searchSlackTool({
        convex,
        clerkId,
        serverSecret,
        companyName,
        domain,
        query,
        channelName,
        messagesPerChannel,
        maxMatches,
      });
      return { content: [{ type: "text", text }] };
    });

    server.registerTool(toolCatalog.listSlackChannels.name, {
      description: toolCatalog.listSlackChannels.description,
      inputSchema: toolCatalog.listSlackChannels.inputSchema.shape,
    }, async ({ query, limit }) => {
      const clerkId = clerkIdStore.getStore() ?? "";
      const text = await listSlackChannelsTool({
        convex,
        clerkId,
        serverSecret,
        query,
        limit,
      });
      return { content: [{ type: "text", text }] };
    });

    server.registerTool(toolCatalog.readSlackThread.name, {
      description: toolCatalog.readSlackThread.description,
      inputSchema: toolCatalog.readSlackThread.inputSchema.shape,
    }, async ({ id, limit }) => {
      const clerkId = clerkIdStore.getStore() ?? "";
      const text = await getSlackThreadTool({
        convex,
        clerkId,
        serverSecret,
        id,
        limit,
      });
      return { content: [{ type: "text", text }] };
    });

    server.registerTool(toolCatalog.readSlackChannel.name, {
      description: toolCatalog.readSlackChannel.description,
      inputSchema: toolCatalog.readSlackChannel.inputSchema.shape,
    }, async ({ channelName, channelId, limit }) => {
      const clerkId = clerkIdStore.getStore() ?? "";
      const text = await getSlackChannelHistoryTool({
        convex,
        clerkId,
        serverSecret,
        channelName,
        channelId,
        limit,
      });
      return { content: [{ type: "text", text }] };
    });

    server.registerTool(toolCatalog.listCompanies.name, {
      description: toolCatalog.listCompanies.description,
      inputSchema: toolCatalog.listCompanies.inputSchema.shape,
    }, async ({ search, status, limit }) => {
      const text = await listCompaniesTool({ convex, serverSecret, search, status, limit });
      return { content: [{ type: "text", text }] };
    });

  },
  {
    serverInfo: {
      name: MCP_SERVER_NAME,
      version: "1.0.0",
      icons: [
        {
          src: `${APP_URL}/icon.png`,
          mimeType: "image/png",
          sizes: ["753x753"],
        },
      ],
    } as Implementation,
  },
  { basePath: "/api" }
);

const authHandler = withMcpAuth(
  async (req: Request) => {
    const clerkId = (req.auth?.extra?.clerkId as string | undefined) ?? "";
    return clerkIdStore.run(clerkId, () => handler(req));
  },
  async (_req: Request, token?: string): Promise<AuthInfo | undefined> => {
    if (!token) return undefined;

    try {
      const clerkAuth = await auth({ acceptsToken: "oauth_token" });
      const authInfo = verifyClerkToken(clerkAuth, token);
      if (authInfo) {
        const clerkId = authInfo.extra?.userId as string | undefined;
        if (clerkId) {
          const email = typeof authInfo.extra?.email === "string" ? authInfo.extra.email : undefined;
          const name = typeof authInfo.extra?.name === "string" ? authInfo.extra.name : undefined;
          const user = await convex.action(api.users.checkChatRateLimit, { clerkId, email, name, serverSecret });
          if (user.ok) {
            convex.mutation(api.users.recordUsage, { userId: user.userId as Id<"users">, endpoint: "mcp", serverSecret }).catch(() => {});
            return { ...authInfo, extra: { ...authInfo.extra, clerkId } };
          }
        }
      }
    } catch {}

    return undefined;
  },
  { required: true }
);

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
