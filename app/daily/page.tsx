import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAdminEmailState } from "@/lib/clerk/admin";
import DailyInsightsClient from "./DailyInsightsClient";

export default async function DailyPage() {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/");

  const adminState = await getAdminEmailState({ userId, sessionClaims });

  return <DailyInsightsClient isAdmin={adminState.isAdmin} />;
}
