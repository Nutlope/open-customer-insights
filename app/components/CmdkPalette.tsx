"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Command } from "cmdk";
import {
  Building2Icon,
  CopyIcon,
  ExternalLinkIcon,
  HomeIcon,
  LinkIcon,
  MessageSquarePlusIcon,
  SwordsIcon,
} from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { MCP_API_URL } from "@/lib/constants";
import { SHOW_CMDK } from "@/lib/features";
import type { CmdkItem } from "@/lib/cmdk/types";
import { useCmdkController } from "./CmdkProvider";

const ITEM_CLASS =
  "flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 rounded-md mx-1 cursor-pointer aria-selected:bg-zinc-100 aria-selected:text-zinc-950";
const ICON_CLASS = "size-4 shrink-0 text-zinc-400";
const GROUP_HEADING_CLASS = "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-400";

const STATUS_BADGE_STYLES: Record<string, string> = {
  customer: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  prospect: "bg-blue-50 text-blue-700 ring-blue-100",
  former_customer: "bg-orange-50 text-orange-700 ring-orange-100",
  unknown: "bg-zinc-50 text-zinc-500 ring-zinc-100",
};

const STATUS_BADGE_LABELS: Record<string, string> = {
  customer: "Customer",
  prospect: "Prospect",
  former_customer: "Former",
  unknown: "Unknown",
};

function MiniStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${STATUS_BADGE_STYLES[status] ?? STATUS_BADGE_STYLES.unknown}`}>
      {STATUS_BADGE_LABELS[status] ?? status}
    </span>
  );
}

function faviconUrl({ domain }: { domain: string }): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function formatLtr({ amount }: { amount?: number }): string | null {
  if (!amount || amount <= 0) return null;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

function renderItem({ item, onSelect }: { item: CmdkItem; onSelect: (item: CmdkItem) => void }) {
  switch (item.type) {
    case "navigate":
      return (
        <Command.Item
          key={`navigate:${item.href}`}
          value={item.label}
          keywords={item.keywords ? [item.keywords] : undefined}
          onSelect={() => onSelect(item)}
          className={ITEM_CLASS}
        >
          {item.icon ?? <LinkIcon className={ICON_CLASS} />}
          <span className="truncate">{item.label}</span>
          <span className="ml-auto truncate font-mono text-[10px] text-zinc-300">{item.href}</span>
        </Command.Item>
      );
    case "action":
      return (
        <Command.Item
          key={`action:${item.label}`}
          value={item.label}
          keywords={item.keywords ? [item.keywords] : undefined}
          onSelect={() => onSelect(item)}
          className={ITEM_CLASS}
        >
          {item.icon ?? <MessageSquarePlusIcon className={ICON_CLASS} />}
          <span className="truncate">{item.label}</span>
        </Command.Item>
      );
    case "copy":
      return (
        <Command.Item key={`copy:${item.label}`} value={item.label} onSelect={() => onSelect(item)} className={ITEM_CLASS}>
          {item.icon ?? <CopyIcon className={ICON_CLASS} />}
          <span className="truncate">{item.label}</span>
        </Command.Item>
      );
    case "external":
      if (item.hidden) return null;
      return (
        <Command.Item key={`external:${item.label}`} value={item.label} onSelect={() => onSelect(item)} className={ITEM_CLASS}>
          {item.icon ?? <ExternalLinkIcon className={ICON_CLASS} />}
          <span className="truncate">{item.label}</span>
        </Command.Item>
      );
    case "company":
      return null;
  }
}

export function CmdkPalette() {
  const { open, setOpen, contextItems } = useCmdkController();
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(handle);
  }, [search]);

  const companies = useQuery(
    api.companies.listCompanies,
    isSignedIn && debouncedSearch.trim().length >= 2 ? { search: debouncedSearch.trim(), limit: 10 } : "skip",
  );

  const navItems = useMemo<CmdkItem[]>(() => {
    return [
      { type: "navigate", label: "Home", href: "/", icon: <HomeIcon className={ICON_CLASS} /> },
      { type: "navigate", label: "Competitors", href: "/competitors", icon: <SwordsIcon className={ICON_CLASS} /> },
      { type: "navigate", label: "Companies", href: "/companies", icon: <Building2Icon className={ICON_CLASS} /> },
    ];
  }, []);

  const globalActions = useMemo<CmdkItem[]>(
    () => [
      {
        type: "action",
        label: "New chat",
        icon: <MessageSquarePlusIcon className={ICON_CLASS} />,
        onSelect: () => {
          if (pathname === "/") {
            const textarea = document.querySelector("textarea");
            textarea?.focus();
          } else {
            router.push("/");
          }
        },
      },
      {
        type: "copy",
        label: "Copy MCP URL",
        icon: <LinkIcon className={ICON_CLASS} />,
        value: MCP_API_URL,
      },
    ],
    [pathname, router],
  );

  function close() {
    setOpen(false);
    setSearch("");
  }

  function handleSelect(item: CmdkItem) {
    switch (item.type) {
      case "navigate":
        router.push(item.href);
        break;
      case "company":
        router.push(`/companies/${encodeURIComponent(item.domain)}`);
        break;
      case "action":
        item.onSelect();
        break;
      case "copy":
        navigator.clipboard.writeText(item.value);
        toast.success("Copied to clipboard");
        break;
      case "external":
        window.open(item.href, "_blank", "noopener,noreferrer");
        break;
    }
    close();
  }

  if (!isLoaded || !isSignedIn || !SHOW_CMDK) return null;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      label="Command Menu"
      shouldFilter
      loop
      overlayClassName="fixed inset-0 bg-black/40 z-50"
      contentClassName="fixed left-1/2 top-[20vh] -translate-x-1/2 w-full max-w-[560px] rounded-xl bg-white shadow-2xl ring-1 ring-zinc-200 z-50 overflow-hidden"
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        placeholder="Search companies, pages, actions…"
        className="h-12 w-full px-4 text-sm border-b border-zinc-100 outline-none placeholder:text-zinc-400"
      />
      <Command.List className="max-h-[360px] overflow-y-auto py-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-zinc-400">No results</Command.Empty>

        {contextItems.length > 0 && (
          <Command.Group heading={<div className={GROUP_HEADING_CLASS}>Current page</div>}>
            {contextItems.map((item) => renderItem({ item, onSelect: handleSelect }))}
          </Command.Group>
        )}

        {companies && companies.length > 0 && (
          <Command.Group heading={<div className={GROUP_HEADING_CLASS}>Companies</div>}>
            {companies.map((company) => {
              const ltr = formatLtr({ amount: company.lifetimeRevenue });
              return (
                <Command.Item
                  key={company._id}
                  value={`${company.name} ${company.domain}`}
                  onSelect={() =>
                    handleSelect({ type: "company", label: company.name, domain: company.domain, status: company.status })
                  }
                  className={ITEM_CLASS}
                >
                  <img src={faviconUrl({ domain: company.domain })} alt="" className="size-4 shrink-0 rounded-sm" />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate font-medium text-zinc-950">{company.name}</span>
                    <span className="truncate font-mono text-[11px] text-zinc-400">{company.domain}</span>
                  </span>
                  <MiniStatusBadge status={company.status} />
                  {ltr && <span className="shrink-0 text-[11px] font-medium text-emerald-700">{ltr}</span>}
                </Command.Item>
              );
            })}
          </Command.Group>
        )}

        <Command.Group heading={<div className={GROUP_HEADING_CLASS}>Navigate</div>}>
          {navItems.map((item) => renderItem({ item, onSelect: handleSelect }))}
        </Command.Group>

        <Command.Group heading={<div className={GROUP_HEADING_CLASS}>Actions</div>}>
          {globalActions.map((item) => renderItem({ item, onSelect: handleSelect }))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
