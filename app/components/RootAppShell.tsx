"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { MCP_API_URL } from "@/lib/constants";
import AppHeader from "./AppHeader";

const sectionLabels: Record<string, string> = {
  companies: "companies",
  competitors: "competitors",
};

function sectionFromPathname({ pathname }: { pathname: string }): string | undefined {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment ? sectionLabels[segment] : undefined;
}

function AuthReady({ children }: { children: React.ReactNode }) {
  const { isLoaded } = useAuth();
  if (!isLoaded) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-800" />
      </div>
    );
  }
  return children;
}

export default function RootAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isChatRoute = pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/");

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-zinc-50 text-zinc-950">
      <AppHeader section={sectionFromPathname({ pathname })} mcpUrl={MCP_API_URL} />
      <div className={`min-h-0 flex-1 overflow-x-hidden ${isChatRoute ? "overflow-y-hidden" : "overflow-y-auto"}`}>
        <AuthReady>{children}</AuthReady>
      </div>
    </div>
  );
}
