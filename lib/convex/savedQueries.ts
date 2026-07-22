import type { Id } from "../../convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../convex/_generated/server";

type Identity = NonNullable<Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>>;

export function titleFromQuery({ query }: { query: string }): string {
  const normalized = query.replace(/\s+/g, " ").trim();
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

export async function getExistingCurrentUserId({
  ctx,
}: {
  ctx: QueryCtx;
}): Promise<Id<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");

  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  return existing?._id ?? null;
}

export async function getOrCreateCurrentUserId({
  ctx,
}: {
  ctx: MutationCtx;
}): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");

  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (existing) return existing._id;

  return await ctx.db.insert("users", {
    clerkId: identity.subject,
    email: identity.email ?? "",
    name: identityName({ identity }),
    createdAt: Date.now(),
  });
}
