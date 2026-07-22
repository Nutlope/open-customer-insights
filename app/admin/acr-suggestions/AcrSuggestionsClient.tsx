"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckIcon, XIcon, DollarSignIcon, ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type StatusFilter = "pending" | "approved" | "rejected";

const STATUS_TABS: StatusFilter[] = ["pending", "approved", "rejected"];

const STATUS_STYLES: Record<StatusFilter, string> = {
  pending: "bg-blue-50 text-blue-700 ring-blue-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

const REASON_STYLES: Record<string, string> = {
  flagged_review: "bg-rose-50 text-rose-700 ring-rose-200",
  near_zero: "bg-amber-50 text-amber-700 ring-amber-200",
};

const REASON_LABELS: Record<string, string> = {
  flagged_review: "likely multi-year total",
  near_zero: "near-zero / placeholder",
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function Badge({ label, style }: { label: string; style: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${style}`}>
      {label}
    </span>
  );
}

function SuggestionCard({
  suggestion,
  onApprove,
  onReject,
  isLoading,
}: {
  suggestion: Doc<"acrSuggestions">;
  onApprove: () => void;
  onReject: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-[0_1px_0_rgba(24,24,27,0.08),0_4px_12px_rgba(24,24,27,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-950">{suggestion.name}</h2>
            <span className="font-mono text-xs text-zinc-400">{suggestion.domain}</span>
            <Badge label={REASON_LABELS[suggestion.reason] ?? suggestion.reason} style={REASON_STYLES[suggestion.reason] ?? "bg-zinc-100 text-zinc-500 ring-zinc-200"} />
            <Badge label={suggestion.status} style={STATUS_STYLES[suggestion.status]} />
            {suggestion.confidence && <Badge label={`ACR: ${suggestion.confidence}`} style="bg-zinc-100 text-zinc-500 ring-zinc-200" />}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500">
            <span>Current ACR: {suggestion.currentAcr !== undefined ? currencyFormatter.format(suggestion.currentAcr) : "—"}</span>
            <span>Proposed ACR: {currencyFormatter.format(suggestion.proposedAcr)}</span>
          </div>

          {suggestion.resolvedAt && (
            <p className="mt-1 text-xs text-zinc-400">
              {suggestion.status === "approved" ? "Approved" : "Rejected"}{" "}
              {new Date(suggestion.resolvedAt).toLocaleDateString()}
              {suggestion.resolvedByEmail ? ` by ${suggestion.resolvedByEmail}` : ""}
            </p>
          )}
        </div>

        {suggestion.status === "pending" && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onReject}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-40"
            >
              <XIcon className="size-3.5" />
              Reject
            </button>
            <button
              onClick={onApprove}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40"
            >
              <CheckIcon className="size-3.5" />
              {isLoading ? "Saving…" : "Approve"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AcrSuggestionsClient() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const suggestions = useQuery(api.companies.listAcrSuggestions, { status: statusFilter });
  const approve = useMutation(api.companies.approveAcrSuggestion);
  const reject = useMutation(api.companies.rejectAcrSuggestion);

  async function handleApprove({ suggestionId }: { suggestionId: Id<"acrSuggestions"> }) {
    setLoadingId(suggestionId);
    try {
      await approve({ suggestionId });
    } finally {
      setLoadingId(null);
    }
  }

  async function handleReject({ suggestionId }: { suggestionId: Id<"acrSuggestions"> }) {
    setLoadingId(suggestionId);
    try {
      await reject({ suggestionId });
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <Link
        href="/admin"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-700"
      >
        <ArrowLeftIcon className="size-3.5" />
        Admin
      </Link>

      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950">ACR Suggestions</h1>
          <p className="mt-1 text-sm text-zinc-500">
            ACR figures from the sales-wins backfill that look like multi-year totals or placeholder values.
            Approve to apply the proposed ACR, or reject to leave the current value.
          </p>
        </div>
        <div className="flex rounded-md bg-zinc-100 p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`rounded px-3 py-1.5 text-xs font-medium capitalize transition ${
                statusFilter === tab
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {suggestions === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-14 text-center shadow-[0_1px_0_rgba(24,24,27,0.08),0_4px_12px_rgba(24,24,27,0.04)]">
          <DollarSignIcon className="mx-auto size-6 text-zinc-300" />
          <p className="mt-3 text-sm font-medium text-zinc-950">No {statusFilter} suggestions</p>
          <p className="mt-1 text-xs text-zinc-400">
            {statusFilter === "pending"
              ? "Run bun run scripts/update-company-acr-from-sales-wins.ts to find candidates."
              : `No suggestions have been ${statusFilter} yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion._id}
              suggestion={suggestion}
              isLoading={loadingId === suggestion._id}
              onApprove={() => handleApprove({ suggestionId: suggestion._id })}
              onReject={() => handleReject({ suggestionId: suggestion._id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
