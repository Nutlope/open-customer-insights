import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CompanyDetailClient } from "./CompanyDetailClient";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const { domain } = await params;
  return <CompanyDetailClient domain={decodeURIComponent(domain)} />;
}
