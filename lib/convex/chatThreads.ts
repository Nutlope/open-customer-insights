import { getThreadMetadata } from "@convex-dev/agent";

import { components } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../convex/_generated/server";

type Identity = NonNullable<Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>>;

export function titleFromPrompt({ prompt }: { prompt: string }): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  if (normalized.length <= 64) return normalized;
  return `${normalized.slice(0, 61).trimEnd()}...`;
}

function identityName({
  identity,
}: {
  identity: Identity;
}): string | undefined {
  if (identity.name?.trim()) return identity.name.trim();
  const fullName = [identity.givenName, identity.familyName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  return identity.nickname?.trim() || undefined;
}

export async function getCurrentUser({
  ctx,
}: {
  ctx: QueryCtx | MutationCtx;
}): Promise<{
  userId: Id<"users">;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");

  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (existing) {
    return { userId: existing._id };
  }

  if (!("insert" in ctx.db)) throw new Error("User not found");

  const userId = await ctx.db.insert("users", {
    clerkId: identity.subject,
    email: identity.email ?? "",
    name: identityName({ identity }),
    createdAt: Date.now(),
  });

  return { userId };
}

export async function assertThreadAccess({
  ctx,
  threadId,
}: {
  ctx: QueryCtx | MutationCtx;
  threadId: string;
}): Promise<{
  userId: Id<"users">;
  thread: Awaited<ReturnType<typeof getThreadMetadata>>;
}> {
  const currentUser = await getCurrentUser({ ctx });
  const thread = await getThreadMetadata(ctx, components.agent, { threadId });
  if (thread.userId !== currentUser.userId) {
    throw new Error("Thread not found");
  }
  return { userId: currentUser.userId, thread };
}
