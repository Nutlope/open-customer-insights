import type { ActionCtx, MutationCtx, QueryCtx } from "../../convex/_generated/server";

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;

interface ServerSecretParams {
  serverSecret?: string;
}

interface AuthenticatedClerkIdParams extends ServerSecretParams {
  ctx: AuthCtx;
  clerkId?: string;
}

interface RequireServerSecretParams extends ServerSecretParams {
  operation: string;
}

export function hasValidServerSecret({ serverSecret }: ServerSecretParams): boolean {
  const expected = process.env.INTERNAL_CONVEX_SECRET;
  return Boolean(expected && serverSecret && serverSecret === expected);
}

export function requireServerSecret({
  operation,
  serverSecret,
}: RequireServerSecretParams): void {
  if (!hasValidServerSecret({ serverSecret })) {
    throw new Error(`Unauthorized ${operation}`);
  }
}

export async function requireAuthenticatedClerkId({
  ctx,
  clerkId,
  serverSecret,
}: AuthenticatedClerkIdParams): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) return identity.subject;

  if (clerkId && hasValidServerSecret({ serverSecret })) {
    return clerkId;
  }

  throw new Error("Unauthorized");
}

export async function requireAuthenticated({ ctx, serverSecret }: { ctx: AuthCtx } & ServerSecretParams): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity || hasValidServerSecret({ serverSecret })) return;
  throw new Error("Unauthorized");
}
