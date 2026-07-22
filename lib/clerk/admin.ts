import { currentUser } from "@clerk/nextjs/server";
import { isAdminEmail } from "@/lib/convex/auth";

type AdminEmailState = {
  email?: string;
  isAdmin: boolean;
};

function stringField({ value, key }: { value: unknown; key: string }): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const field = record[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function emailFromSessionClaims({ sessionClaims }: { sessionClaims: unknown }): string | undefined {
  return (
    stringField({ value: sessionClaims, key: "email" }) ??
    stringField({ value: sessionClaims, key: "emailAddress" }) ??
    stringField({ value: sessionClaims, key: "email_address" }) ??
    stringField({ value: sessionClaims, key: "primaryEmailAddress" }) ??
    stringField({ value: sessionClaims, key: "primary_email_address" })
  );
}

export async function getAdminEmailState({
  userId,
  sessionClaims,
}: {
  userId?: string | null;
  sessionClaims: unknown;
}): Promise<AdminEmailState> {
  const claimEmail = emailFromSessionClaims({ sessionClaims });
  const user = userId && !claimEmail ? await currentUser() : null;
  const userEmails = user?.emailAddresses
    .map((emailAddress) => emailAddress.emailAddress)
    .filter(Boolean) ?? [];
  const email = claimEmail ?? userEmails[0];
  const isAdmin = isAdminEmail({ email });

  return { email, isAdmin };
}
