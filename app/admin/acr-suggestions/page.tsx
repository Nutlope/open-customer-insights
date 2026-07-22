import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AcrSuggestionsClient } from "./AcrSuggestionsClient";

export default async function AcrSuggestionsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");
  return <AcrSuggestionsClient />;
}
