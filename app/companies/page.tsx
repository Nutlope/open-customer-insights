import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CompaniesClient } from "./CompaniesClient";

export default async function CompaniesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  return <CompaniesClient />;
}
