import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { RevenueClient } from "./RevenueClient";

export default async function RevenuePage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  return <RevenueClient />;
}
