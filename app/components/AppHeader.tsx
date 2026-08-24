"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { SHOW_CMDK } from "@/lib/features";
import { cn } from "@/lib/utils";
import ConnectMcpPopover from "./ConnectMcpPopover";
import { useCmdkController } from "./CmdkProvider";
import { SourceIcon } from "./sourceVisuals";

function HeaderLink({
  href,
  isSelected,
  icon,
  className,
  children,
}: {
  href: string;
  isSelected: boolean;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors",
        isSelected ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
        className
      )}
    >
      {icon}
      <span className={icon ? "sr-only sm:not-sr-only sm:inline" : undefined}>{children}</span>
    </Link>
  );
}

export default function AppHeader({
  section,
  mcpUrl,
}: {
  section?: string;
  mcpUrl?: string;
}) {
  const { isSignedIn, isLoaded } = useAuth();
  const { setOpen: setCmdkOpen } = useCmdkController();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Image
            src="/icon.png"
            alt="Customer Insights"
            width={28}
            height={28}
            className="size-7 rounded-lg"
            priority
          />
          <span className="hidden text-xs font-mono font-medium text-zinc-400 sm:inline">{APP_NAME}</span>
        </Link>
        {section && (
          <>
            <span className="hidden font-mono text-xs text-zinc-300 sm:inline">/</span>
            <span className="truncate font-mono text-xs font-medium text-zinc-500">{section}</span>
          </>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs sm:gap-3">
        {isLoaded && isSignedIn && mcpUrl && (
          <div className="hidden md:block">
            <ConnectMcpPopover mcpUrl={mcpUrl} />
          </div>
        )}
        {isLoaded && isSignedIn && (
          <nav className="flex min-w-0 items-center gap-0.5 font-mono sm:gap-1">
            <HeaderLink href="/" isSelected={!section}>
              Home
            </HeaderLink>
            <HeaderLink
              href="/competitors"
              isSelected={section === "competitors"}
              icon={<SourceIcon source="competitors" />}
            >
              Competitors
            </HeaderLink>
            <HeaderLink
              href="/companies"
              isSelected={section === "companies"}
              icon={<SourceIcon source="companies" />}
            >
              Companies
            </HeaderLink>
          </nav>
        )}
        {isLoaded && isSignedIn && SHOW_CMDK && (
          <button
            onClick={() => setCmdkOpen(true)}
            className="hidden items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[11px] text-zinc-400 hover:border-zinc-300 hover:text-zinc-600 sm:inline-flex"
          >
            <span>Search</span>
            <kbd className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-medium text-zinc-400 ring-1 ring-zinc-200">⌘K</kbd>
          </button>
        )}
        {!isLoaded ? null : isSignedIn ? (
          <UserButton />
        ) : (
          <SignInButton mode="modal">
            <button className="cursor-pointer rounded-md bg-black px-3 py-1.5 font-mono text-xs font-medium text-white transition-[opacity,transform] hover:opacity-80 active:scale-[0.98]">
              Get Insights
            </button>
          </SignInButton>
        )}
      </div>
    </header>
  );
}
