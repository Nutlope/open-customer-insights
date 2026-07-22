"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SHOW_HEALTH_SCORES } from "@/lib/features";
import { useCmdkContext } from "@/app/components/CmdkProvider";
import type { CmdkItem } from "@/lib/cmdk/types";
import { useQuery } from "convex/react";
import { Building2Icon, ExternalLinkIcon, PhoneIcon, TicketIcon, SearchIcon, ArrowRightIcon, ArrowUpDownIcon, ArrowUpIcon, ArrowDownIcon, FilterIcon, XIcon, InfoIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { HealthChip } from "@/components/health-chip";
import { CompanyLogo } from "@/components/company-logo";
import { isPlaceholderDomain } from "@/lib/domain/placeholderDomain";
import { companyAskPromptHref } from "@/lib/chat/askPrompt";
import { REVENUE_CATEGORIES, REVENUE_CATEGORY_LABELS, type RevenueCategory } from "@/lib/revenue/categories";

type StatusFilter = "all" | "customer" | "prospect";
type SortOption = "activity" | "lifetimeRevenue" | "name";
type SortDir = "asc" | "desc";
type RevenueCategoryFilter = "all" | RevenueCategory;

const DEFAULT_SORT_DIR: Record<SortOption, SortDir> = {
  activity: "desc",
  lifetimeRevenue: "desc",
  name: "asc",
};

const CURRENT_YEAR = new Date().getFullYear();
const REVENUE_YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];
const COMPANIES_LIMIT = 300;

function parseRevenueCategoryFilter({ value }: { value: string }): RevenueCategoryFilter {
  return REVENUE_CATEGORIES.includes(value as RevenueCategory) ? (value as RevenueCategory) : "all";
}

function parseStatusFilter({ value }: { value: string | null }): StatusFilter {
  return value === "all" || value === "customer" || value === "prospect" ? value : "customer";
}

function parseSortOption({ value }: { value: string | null }): SortOption {
  return value === "activity" || value === "lifetimeRevenue" || value === "name" ? value : "activity";
}

function parseSortDir({ value }: { value: string | null }): SortDir | null {
  return value === "asc" || value === "desc" ? value : null;
}

function formatCurrency({ amount }: { amount?: number }): string | null {
  if (!amount || amount <= 0) return null;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

function formatDate({ value }: { value?: string | number | null }): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    customer: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    prospect: "bg-blue-50 text-blue-700 ring-blue-100",
    former_customer: "bg-orange-50 text-orange-700 ring-orange-100",
    unknown: "bg-zinc-50 text-zinc-500 ring-zinc-100",
  };
  const label: Record<string, string> = {
    customer: "Customer",
    prospect: "Prospect",
    former_customer: "Former",
    unknown: "Unknown",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${map[status] ?? map.unknown}`}>
      {label[status] ?? status}
    </span>
  );
}

const REVENUE_CATEGORY_LABEL: Record<string, string> = {
  inference: "Inf",
  gpu_cluster: "GPU",
  credits_other: "Other",
};

const REVENUE_CATEGORY_FULL_LABEL: Record<string, string> = {
  inference: "Inference",
  gpu_cluster: "GPU cluster",
  credits_other: "Credits / other",
};

const REVENUE_CATEGORY_STYLE: Record<string, string> = {
  inference: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  gpu_cluster: "bg-purple-50 text-purple-700 ring-purple-100",
  credits_other: "bg-zinc-50 text-zinc-500 ring-zinc-100",
};

function RevenueCategoryBadges({ categories }: { categories?: string[] }) {
  if (!categories || categories.length === 0) {
    return <span className="text-zinc-300">—</span>;
  }
  return (
    <span className="flex flex-nowrap items-center justify-center gap-1">
      {categories.map((category) => (
        <span
          key={category}
          title={REVENUE_CATEGORY_FULL_LABEL[category] ?? category}
          className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ring-1 ${REVENUE_CATEGORY_STYLE[category] ?? REVENUE_CATEGORY_STYLE.credits_other}`}
        >
          {REVENUE_CATEGORY_LABEL[category] ?? category}
        </span>
      ))}
    </span>
  );
}

function SortHeader({
  label,
  field,
  align = "left",
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortOption;
  align?: "left" | "center" | "right";
  sortBy: SortOption;
  sortDir: SortDir;
  onSort: (field: SortOption) => void;
}) {
  const isActive = sortBy === field;
  const Icon = isActive ? (sortDir === "asc" ? ArrowUpIcon : ArrowDownIcon) : ArrowUpDownIcon;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <button
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 ${justify} transition ${
        isActive ? "text-zinc-700" : "text-zinc-400 hover:text-zinc-600"
      }`}
    >
      {label}
      <Icon className={`size-3 ${isActive ? "" : "opacity-40"}`} />
    </button>
  );
}

export function CompaniesClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [statusFilter, setStatusFilterState] = useState<StatusFilter>(() =>
    parseStatusFilter({ value: searchParams.get("status") })
  );
  const [sortBy, setSortByState] = useState<SortOption>(() =>
    parseSortOption({ value: searchParams.get("sort") })
  );
  const [sortDir, setSortDirState] = useState<SortDir>(() => {
    const initialSortBy = parseSortOption({ value: searchParams.get("sort") });
    return parseSortDir({ value: searchParams.get("dir") }) ?? DEFAULT_SORT_DIR[initialSortBy];
  });
  const [revenueYear, setRevenueYear] = useState<number | null>(null);
  const [revenueCategoryFilter, setRevenueCategoryFilter] = useState<RevenueCategoryFilter>("all");
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("q") ?? "");
  const [selectedId, setSelectedId] = useState<Id<"companyProfiles"> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const listScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const updateParams = useCallback(
    ({ updates }: { updates: Record<string, string | null> }) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const setStatusFilter = useCallback(
    (value: StatusFilter) => {
      setStatusFilterState(value);
      updateParams({ updates: { status: value === "customer" ? null : value } });
    },
    [updateParams]
  );

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      updateParams({ updates: { q: value.trim() || null } });
    }, 300);
  }, [updateParams]);

  const handleSort = useCallback((field: SortOption) => {
    setSelectedId(null);
    let nextSortBy = sortBy;
    let nextSortDir: SortDir;
    if (sortBy === field) {
      nextSortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      nextSortBy = field;
      nextSortDir = DEFAULT_SORT_DIR[field];
    }
    setSortByState(nextSortBy);
    setSortDirState(nextSortDir);
    updateParams({
      updates: {
        sort: nextSortBy === "activity" ? null : nextSortBy,
        dir: nextSortDir === DEFAULT_SORT_DIR[nextSortBy] ? null : nextSortDir,
      },
    });
    listScrollRef.current?.scrollTo({ top: 0 });
  }, [sortBy, sortDir, updateParams]);

  const clearFilters = useCallback(() => {
    setStatusFilterState("customer");
    setSortByState("activity");
    setSortDirState(DEFAULT_SORT_DIR.activity);
    setSearch("");
    setDebouncedSearch("");
    setRevenueYear(null);
    setRevenueCategoryFilter("all");
    setSelectedId(null);
    updateParams({ updates: { status: null, sort: null, dir: null, q: null } });
  }, [updateParams]);

  const hasActiveFilters =
    statusFilter !== "customer" ||
    sortBy !== "activity" ||
    sortDir !== DEFAULT_SORT_DIR.activity ||
    search.trim().length > 0 ||
    revenueYear !== null ||
    revenueCategoryFilter !== "all";

  const stats = useQuery(api.companies.getCompanyStats);
  const trimmedSearch = debouncedSearch.trim();
  const isSearching = trimmedSearch.length > 0;
  const companies = useQuery(api.companies.listCompanies, {
    // Search always spans every status tab, so the status filter is dropped
    // while a search is active — see convex/companies.ts listCompanies.
    status: !isSearching && statusFilter !== "all" ? statusFilter : undefined,
    search: trimmedSearch || undefined,
    sortBy,
    sortDir,
    revenueYear: revenueYear ?? undefined,
    revenueCategory: revenueCategoryFilter === "all" ? undefined : revenueCategoryFilter,
    limit: COMPANIES_LIMIT,
  });

  const selectedCompany = companies?.find((c) => c._id === selectedId) ?? companies?.[0] ?? null;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (!companies || companies.length === 0) return;
      if (document.querySelector("[data-source-detail-modal='true']")) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("textarea, select, [contenteditable='true']")) return;

      event.preventDefault();
      const currentIndex = companies.findIndex((c) => c._id === selectedCompany?._id);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), companies.length - 1);
      const nextCompany = companies[nextIndex];
      if (nextCompany && nextCompany._id !== selectedCompany?._id) {
        setSelectedId(nextCompany._id);
        itemRefs.current.get(nextCompany._id)?.scrollIntoView({ block: "nearest" });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [companies, selectedCompany]);
  const companyDetail = useQuery(
    api.companies.getCompany,
    selectedCompany ? { domain: selectedCompany.domain } : "skip"
  );

  const latestReflection = useQuery(
    api.companyTimeline.getLatestReflection,
    selectedCompany ? { companyId: selectedCompany._id } : "skip"
  );


  const cmdkItems = useMemo<CmdkItem[]>(
    () => [
      {
        type: "action",
        label: "Filter: customers only",
        icon: <Building2Icon className="size-4 shrink-0 text-zinc-400" />,
        onSelect: () => { setStatusFilter("customer"); setSelectedId(null); },
      },
      {
        type: "action",
        label: "Filter: prospects only",
        icon: <Building2Icon className="size-4 shrink-0 text-zinc-400" />,
        onSelect: () => { setStatusFilter("prospect"); setSelectedId(null); },
      },
      {
        type: "action",
        label: "Filter: all companies",
        icon: <Building2Icon className="size-4 shrink-0 text-zinc-400" />,
        onSelect: () => { setStatusFilter("all"); setSelectedId(null); },
      },
    ],
    [setStatusFilter, setSelectedId],
  );
  useCmdkContext({ items: cmdkItems, key: "companies" });

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "customer", label: "Customers" },
    { key: "prospect", label: "Prospects" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-5">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-zinc-950">
          Companies
          {stats && (
            <span className="ml-2 text-sm font-normal text-zinc-400">
              ({stats.customers.toLocaleString()} customers)
            </span>
          )}
        </h1>
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-zinc-400">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          This list reflects sales-led deals only. It doesn&apos;t include customers who use Together AI purely
          through self-serve APIs (e.g. fine-tuning or serverless inference).
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md bg-zinc-100 p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setStatusFilter(tab.key); setSelectedId(null); }}
              className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === tab.key
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name or domain…"
            className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-sm outline-none transition focus:border-zinc-400"
          />
        </label>
        <div className="flex h-9 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-600 transition focus-within:border-zinc-400">
          <FilterIcon className="size-3.5 text-zinc-400" />
          <select
            value={revenueYear ?? "all"}
            onChange={(e) => {
              setRevenueYear(e.target.value === "all" ? null : Number(e.target.value));
              setSelectedId(null);
            }}
            aria-label="Revenue year"
            className="h-7 border-0 bg-transparent pl-1 pr-6 text-sm outline-none"
          >
            <option value="all">Any year</option>
            {REVENUE_YEARS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <span className="h-4 w-px bg-zinc-200" />
          <select
            value={revenueCategoryFilter}
            onChange={(e) => {
              setRevenueCategoryFilter(parseRevenueCategoryFilter({ value: e.target.value }));
              setSelectedId(null);
            }}
            aria-label="Revenue type"
            className="h-7 border-0 bg-transparent pl-1 pr-6 text-sm outline-none"
          >
            <option value="all">Any type</option>
            {REVENUE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {REVENUE_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isSearching && statusFilter !== "all" && (
        <p className="mb-3 -mt-1 text-xs text-zinc-400">
          Searching across all categories — results may include companies outside the &quot;
          {STATUS_TABS.find((tab) => tab.key === statusFilter)?.label}&quot; tab.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Company list */}
        <section className="overflow-hidden rounded-lg bg-white shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
          <div className="hidden grid-cols-[minmax(0,1fr)_80px_130px_90px_90px_32px] border-b border-zinc-100 px-4 py-2 text-[11px] font-medium sm:grid">
            <SortHeader label="Company" field="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            <span className="text-center text-zinc-400">Status</span>
            <span className="text-center text-zinc-400">Type</span>
            <SortHeader label="LTR" field="lifetimeRevenue" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
            <SortHeader label="Activity" field="activity" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
          </div>
          <div ref={listScrollRef} className="divide-y divide-zinc-50 overflow-y-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
            {companies === undefined ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="size-9 animate-pulse rounded-md bg-zinc-100" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-40 animate-pulse rounded bg-zinc-100" />
                    <div className="h-2.5 w-24 animate-pulse rounded bg-zinc-50" />
                  </div>
                </div>
              ))
            ) : companies.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Building2Icon className="mx-auto size-5 text-zinc-300" />
                <h2 className="mt-3 text-sm font-semibold text-zinc-950">No companies found</h2>
                <p className="mt-1 text-sm text-zinc-500">Try a different name or filter.</p>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
                  >
                    <XIcon className="size-3" />
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              companies.map((company) => {
                const isSelected = selectedCompany?._id === company._id;
                const ltr = formatCurrency({ amount: company.lifetimeRevenue });
                return (
                  <button
                    key={company._id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(company._id, el);
                      else itemRefs.current.delete(company._id);
                    }}
                    onClick={() => setSelectedId(company._id)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_32px] items-center gap-2 px-4 py-2.5 text-left transition sm:grid-cols-[minmax(0,1fr)_80px_130px_90px_90px_32px] sm:gap-0 ${
                      isSelected ? "bg-zinc-50 shadow-[inset_3px_0_0_0_#18181b]" : "hover:bg-zinc-50"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <CompanyLogo domain={company.domain} name={company.name} />
                      <span className="min-w-0">
                        <Link
                          href={`/companies/${encodeURIComponent(company.domain)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate text-sm font-semibold text-zinc-950 hover:text-zinc-700 hover:underline underline-offset-2"
                          title="Open company page"
                        >
                          {company.name}
                        </Link>
                        <span className="block truncate font-mono text-[11px] text-zinc-400">
                          {isPlaceholderDomain({ domain: company.domain }) ? "Domain unknown" : company.domain}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 sm:hidden">
                          <StatusBadge status={company.status} />
                          <RevenueCategoryBadges categories={company.revenueCategories} />
                          {ltr && <span className="text-[11px] font-medium text-emerald-700">LTR {ltr}</span>}
                          <span className="text-[11px] text-zinc-400">{formatDate({ value: company.lastActivityAt })}</span>
                        </span>
                      </span>
                    </span>
                    <span className="hidden justify-center sm:flex">
                      <StatusBadge status={company.status} />
                    </span>
                    <span className="hidden justify-center sm:flex">
                      <RevenueCategoryBadges categories={company.revenueCategories} />
                    </span>
                    <span className="hidden truncate text-right text-xs font-medium text-emerald-700 sm:block">
                      {ltr ?? <span className="text-zinc-300">—</span>}
                    </span>
                    <span className="hidden truncate text-right text-xs text-zinc-400 sm:block">
                      {formatDate({ value: company.lastActivityAt })}
                    </span>
                    <Link
                      href={`/companies/${encodeURIComponent(company.domain)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition"
                      title="Open detail page"
                    >
                      <ArrowRightIcon className="size-4" />
                    </Link>
                  </button>
                );
              })
            )}
          </div>
          {companies && companies.length === COMPANIES_LIMIT && (
            <div className="border-t border-zinc-100 px-4 py-2 text-center text-xs text-zinc-400">
              Showing first {COMPANIES_LIMIT} results — use search to narrow down
            </div>
          )}
        </section>

        {/* Detail panel */}
        <aside className="rounded-lg bg-white shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] overflow-y-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
          {selectedCompany ? (
            <div className="p-4">
              <div className="flex min-w-0 items-start gap-3">
                <CompanyLogo domain={selectedCompany.domain} name={selectedCompany.name} size="size-12" textSize="text-base" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="truncate text-lg font-semibold text-zinc-950">{selectedCompany.name}</h2>
                    <a
                      href={companyAskPromptHref({ name: selectedCompany.name, domain: selectedCompany.domain })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 transition"
                    >
                      <SparklesIcon className="size-3" />
                      Ask AI
                    </a>
                  </div>
                  {isPlaceholderDomain({ domain: selectedCompany.domain }) ? (
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-zinc-400">
                      Domain unknown
                    </span>
                  ) : (
                    <a
                      href={`https://${selectedCompany.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-zinc-400 hover:text-zinc-600"
                    >
                      {selectedCompany.domain}
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={selectedCompany.status} />
                    {selectedCompany.lifetimeRevenue && selectedCompany.lifetimeRevenue > 0 && (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 bg-emerald-50 text-emerald-700 ring-emerald-100">
                        LTR {formatCurrency({ amount: selectedCompany.lifetimeRevenue })}
                      </span>
                    )}
                    {latestReflection?.riskScore !== undefined && (
                      <HealthChip score={latestReflection.riskScore} />
                    )}
                  </div>
                </div>
              </div>

              {selectedCompany.salesforceId && (
                <a
                  href={`https://app.salesforce.com/${selectedCompany.salesforceId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600"
                >
                  <ExternalLinkIcon className="size-3" />
                  View in Salesforce
                </a>
              )}

              {/* Stats row */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-md bg-zinc-50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <PhoneIcon className="size-3" />
                    Calls
                  </div>
                  <div className="mt-0.5 text-lg font-semibold text-zinc-950">
                    {companyDetail?.callCount ?? <span className="text-zinc-300">—</span>}
                  </div>
                  {companyDetail?.lastCallAt && (
                    <div className="text-[11px] text-zinc-400">Last: {formatDate({ value: companyDetail.lastCallAt })}</div>
                  )}
                </div>
                <div className="rounded-md bg-zinc-50 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <TicketIcon className="size-3" />
                    Tickets
                  </div>
                  <div className="mt-0.5 text-lg font-semibold text-zinc-950">
                    {companyDetail?.ticketCount ?? <span className="text-zinc-300">—</span>}
                  </div>
                  {companyDetail?.lastTicketAt && (
                    <div className="text-[11px] text-zinc-400">Last: {formatDate({ value: companyDetail.lastTicketAt })}</div>
                  )}
                </div>
              </div>

              {companyDetail?.description && (
                <p className="mt-3 text-sm leading-5 text-zinc-600">{companyDetail.description}</p>
              )}

              {latestReflection && (
                <div className={`mt-4 rounded-lg p-3 border-l-2 ${
                  !SHOW_HEALTH_SCORES
                    ? "bg-zinc-50 border-l-zinc-200"
                    : (latestReflection.riskScore ?? 0) >= 61
                    ? "bg-red-50/50 border-l-red-300"
                    : (latestReflection.riskScore ?? 0) >= 31
                    ? "bg-amber-50/50 border-l-amber-300"
                    : "bg-zinc-50 border-l-emerald-300"
                }`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <SparklesIcon className="size-3 text-zinc-400 shrink-0" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                      Latest AI reflection
                    </span>
                    {latestReflection.weekStart && (
                      <span className="ml-auto text-[10px] text-zinc-400">
                        {new Date(latestReflection.weekStart).toLocaleDateString("en", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-600 italic line-clamp-3">
                    {latestReflection.content}
                  </p>
                </div>
              )}

              <Link
                href={`/companies/${encodeURIComponent(selectedCompany.domain)}`}
                className="mt-4 flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 transition"
              >
                View full timeline
                <ArrowRightIcon className="size-4 text-zinc-400" />
              </Link>
            </div>
          ) : (
            <div className="py-16 text-center">
              <Building2Icon className="mx-auto size-5 text-zinc-300" />
              <h2 className="mt-3 text-sm font-semibold text-zinc-950">Select a company</h2>
              <p className="mt-1 text-sm text-zinc-500">Pick a company to see its stats and open the full timeline.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
