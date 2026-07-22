import { mutation, internalMutation, internalQuery, action, query } from "./_generated/server";
import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { rateLimiter } from "./rateLimits";
import { summarizeUsage } from "../lib/convex/usage";
import { requireAdmin, requireAuthenticatedClerkId, requireServerSecret } from "../lib/convex/auth";

async function checkRateLimit({
  ctx,
  user,
}: {
  ctx: ActionCtx;
  user: { _id: string };
}): Promise<{ ok: true; userId: string } | { ok: false; error: "Rate limit exceeded" }> {
  try {
    await rateLimiter.limit(ctx, "chatPerUser", { key: user._id, count: 1 });
    return { ok: true, userId: user._id };
  } catch {
    return { ok: false, error: "Rate limit exceeded" };
  }
}

function getIdentityName({
  identity,
}: {
  identity: { name?: string; givenName?: string; familyName?: string; nickname?: string };
}): string | undefined {
  if (identity.name?.trim()) return identity.name.trim();
  const fullName = [identity.givenName, identity.familyName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  return identity.nickname?.trim() || undefined;
}

export const upsertUser = internalMutation({
  args: { clerkId: v.string(), email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { clerkId, email, name }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (existing) {
      const patch: { email?: string; name?: string } = {};
      if (email && existing.email !== email) patch.email = email;
      if (name && existing.name !== name) patch.name = name;
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    const id = await ctx.db.insert("users", {
      clerkId,
      email,
      ...(name ? { name } : {}),
      createdAt: Date.now(),
    });
    return id;
  },
});

export const ensureUser = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const t0 = performance.now();
    const identity = await ctx.auth.getUserIdentity();
    console.log("[convex:ensureUser] getUserIdentity took", Math.round(performance.now() - t0), "ms");
    if (!identity) throw new Error("Unauthorized");

    const t1 = performance.now();
    await ctx.runMutation(internal.users.upsertUser, {
      clerkId: identity.subject,
      email: identity.email ?? "",
      name: getIdentityName({ identity }),
    });
    console.log("[convex:ensureUser] mutation upsertUser took", Math.round(performance.now() - t1), "ms");
    console.log("[convex:ensureUser] total", Math.round(performance.now() - t0), "ms");
  },
});

export const getUserByClerkId = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    return ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
  },
});

export const checkChatRateLimit = action({
  args: {
    clerkId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { clerkId, email, name, serverSecret }): Promise<{ ok: true; userId: string } | { ok: false; error: string }> => {
    await rateLimiter.limit(ctx, "auth", { count: 1 });
    const authenticatedClerkId = await requireAuthenticatedClerkId({ ctx, clerkId, serverSecret });
    const existing = await ctx.runQuery(internal.users.getUserByClerkId, { clerkId: authenticatedClerkId });
    if (existing) {
      const identity = await ctx.auth.getUserIdentity();
      const nextEmail = identity?.email ?? email;
      const nextName = identity ? getIdentityName({ identity }) : name;
      if ((nextEmail && nextEmail !== existing.email) || (nextName && nextName !== existing.name)) {
        await ctx.runMutation(internal.users.upsertUser, {
          clerkId: authenticatedClerkId,
          email: nextEmail ?? existing.email,
          name: nextName,
        });
      }
      return checkRateLimit({ ctx, user: existing });
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      await ctx.runMutation(internal.users.upsertUser, {
        clerkId: authenticatedClerkId,
        email: email ?? "",
        name,
      });
      const user = await ctx.runQuery(internal.users.getUserByClerkId, { clerkId: authenticatedClerkId });
      if (!user) return { ok: false, error: "User not found" };
      return checkRateLimit({ ctx, user });
    }

    await ctx.runMutation(internal.users.upsertUser, {
      clerkId: identity.subject,
      email: identity.email ?? "",
      name: getIdentityName({ identity }),
    });
    const user = await ctx.runQuery(internal.users.getUserByClerkId, { clerkId: authenticatedClerkId });
    if (!user) return { ok: false, error: "User not found" };

    return checkRateLimit({ ctx, user });
  },
});

export const getUsersMissingIdentityFields = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("users").collect();
    return all.filter((u) => !u.name?.trim() || !u.email.trim());
  },
});

export const patchUserIdentityFields = internalMutation({
  args: { userId: v.id("users"), email: v.optional(v.string()), name: v.optional(v.string()) },
  handler: async (ctx, { userId, email, name }) => {
    const patch: { email?: string; name?: string } = {};
    if (email?.trim()) patch.email = email.trim();
    if (name?.trim()) patch.name = name.trim();
    if (Object.keys(patch).length > 0) await ctx.db.patch(userId, patch);
  },
});

function getPrimaryEmail({
  emailAddresses,
  primaryEmailAddressId,
}: {
  emailAddresses?: Array<{ id?: string | null; email_address?: string | null }>;
  primaryEmailAddressId?: string | null;
}): string | undefined {
  const primaryEmail = emailAddresses?.find((emailAddress) => emailAddress.id === primaryEmailAddressId)?.email_address;
  return primaryEmail?.trim() || emailAddresses?.find((emailAddress) => emailAddress.email_address?.trim())?.email_address?.trim() || undefined;
}

export const backfillUserIdentityFields = action({
  args: {},
  handler: async (ctx): Promise<{ patched: number; skipped: number; errors: number }> => {
    await requireAdmin({ ctx });
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) throw new Error("CLERK_SECRET_KEY is not set in Convex environment variables");

    const users = await ctx.runQuery(internal.users.getUsersMissingIdentityFields);

    let patched = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of users) {
      try {
        const resp = await fetch(`https://api.clerk.com/v1/users/${user.clerkId}`, {
          headers: { Authorization: `Bearer ${clerkSecretKey}` },
        });
        if (!resp.ok) {
          console.error(`[backfillUserNames] Clerk API error for ${user.clerkId}: ${resp.status}`);
          errors++;
          continue;
        }
        const data = (await resp.json()) as {
          first_name?: string | null;
          last_name?: string | null;
          username?: string | null;
          primary_email_address_id?: string | null;
          email_addresses?: Array<{ id?: string | null; email_address?: string | null }>;
        };
        const name =
          [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
          data.username?.trim() ||
          undefined;
        const email = getPrimaryEmail({
          emailAddresses: data.email_addresses,
          primaryEmailAddressId: data.primary_email_address_id,
        });

        const nextName = user.name?.trim() ? undefined : name;
        const nextEmail = user.email.trim() ? undefined : email;

        if (nextName || nextEmail) {
          await ctx.runMutation(internal.users.patchUserIdentityFields, {
            userId: user._id,
            name: nextName,
            email: nextEmail,
          });
          console.log(`[backfillUserIdentityFields] patched ${user.clerkId}`);
          patched++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`[backfillUserIdentityFields] unexpected error for ${user.clerkId}:`, err);
        errors++;
      }
    }

    console.log(`[backfillUserIdentityFields] done — patched=${patched} skipped=${skipped} errors=${errors}`);
    return { patched, skipped, errors };
  },
});


export const recordUsage = mutation({
  args: {
    userId: v.id("users"),
    endpoint: v.string(),
    tokensUsed: v.optional(v.number()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { userId, endpoint, tokensUsed, serverSecret }) => {
    if (!serverSecret || !process.env.INTERNAL_CONVEX_SECRET || serverSecret !== process.env.INTERNAL_CONVEX_SECRET) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) throw new Error("Unauthorized");
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject)).unique();
      if (!user || user._id !== userId) throw new Error("Forbidden");
    }
    await ctx.db.insert("apiKeyUsage", { userId, endpoint, tokensUsed, timestamp: Date.now() });
  },
});

export const recordUserQuery = mutation({
  args: {
    userId: v.id("users"),
    channel: v.union(v.literal("chat"), v.literal("mcp"), v.literal("slack")),
    query: v.string(),
    threadId: v.optional(v.string()),
    source: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    limit: v.optional(v.number()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, { userId, channel, query, threadId, source, fromDate, toDate, limit, serverSecret }) => {
    if (!serverSecret || !process.env.INTERNAL_CONVEX_SECRET || serverSecret !== process.env.INTERNAL_CONVEX_SECRET) {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) throw new Error("Unauthorized");
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject)).unique();
      if (!user || user._id !== userId) throw new Error("Forbidden");
    }
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    await ctx.db.insert("userQueries", {
      userId,
      channel,
      query: trimmedQuery,
      threadId,
      source,
      fromDate,
      toDate,
      limit,
      timestamp: Date.now(),
    });
  },
});

export const recordUserQueryByClerkId = mutation({
  args: {
    clerkId: v.string(),
    serverSecret: v.optional(v.string()),
    channel: v.union(v.literal("chat"), v.literal("mcp"), v.literal("slack")),
    query: v.string(),
    threadId: v.optional(v.string()),
    source: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { clerkId, serverSecret, channel, query, threadId, source, fromDate, toDate, limit }) => {
    requireServerSecret({ operation: "user query recording", serverSecret });
    const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();
    const trimmedQuery = query.trim();
    if (!user || !trimmedQuery) return;
    await ctx.db.insert("userQueries", {
      userId: user._id,
      channel,
      query: trimmedQuery,
      threadId,
      source,
      fromDate,
      toDate,
      limit,
      timestamp: Date.now(),
    });
  },
});

export const getUsageSummary = query({
  args: {
    userId: v.optional(v.string()),
    weekFilter: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, weekFilter, limit }) => {
    await requireAdmin({ ctx });

    const [users, usage] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("apiKeyUsage").order("desc").take(limit ?? 10000),
    ]);

    return summarizeUsage({
      users,
      usage,
      userFilter: userId,
      weekFilter,
    });
  },
});

export const getUserQueryHistory = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, limit }) => {
    await requireAdmin({ ctx });

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    const queries = await ctx.db
      .query("userQueries")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 200);
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId,
      order: "desc",
      paginationOpts: {
        cursor: null,
        numItems: Math.max(1, Math.min(limit ?? 200, 500)),
      },
    });

    return {
      user: {
        userId: user._id,
        clerkId: user.clerkId,
        email: user.email,
        name: user.name,
      },
      queries,
      threads: threads.page
        .filter((thread) => thread.status === "active")
        .map((thread) => ({
          threadId: thread._id,
          title: thread.title ?? "New chat",
          summary: thread.summary,
          createdAt: thread._creationTime,
        })),
    };
  },
});
