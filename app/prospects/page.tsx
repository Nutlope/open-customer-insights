import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAdminEmailState } from "@/lib/clerk/admin";
import { ProspectsClient } from "./ProspectsClient";

export default async function ProspectsPage() {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/");

  const adminState = await getAdminEmailState({ userId, sessionClaims });

  return (
    <Suspense>
      <ProspectsClient isAdmin={adminState.isAdmin} />
    </Suspense>
  );
}
