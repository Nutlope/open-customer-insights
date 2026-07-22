"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  Clock3Icon,
  FileTextIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isPlaceholderDomain } from "@/lib/domain/placeholderDomain";
import { useCmdkContext } from "@/app/components/CmdkProvider";
import type { CmdkItem } from "@/lib/cmdk/types";
import {
  SourceViewer,
  type SourceDetail,
  type SourceReference,
} from "@/components/source-detail-renderer";

type InsightSentiment = "positive" | "negative" | "neutral";
type InsightStatus = "review" | "posted" | "dismissed";
type SourceRef = {
  source: "call" | "support";
  id: string;
  title?: string;
};
type DailyInsight = {
  _id: Id<"dailyInsights">;
  _creationTime: number;
  reportId: Id<"reports">;
  highlightKey: string;
  periodStart: string;
  periodEnd: string;
  title: string;
  description: string;
  company?: string;
  companyDomain?: string;
  sourceRefs?: SourceRef[];
  sentiment: InsightSentiment;
  status: InsightStatus;
  generatedAt: number;
  updatedAt: number;
  updatedByEmail?: string;
  postedAt?: number;
  dismissedAt?: number;
  dismissReason?: string;
  slackChannel?: string;
  slackMessageTs?: string;
};
export type DailyReport = {
  id: Id<"reports">;
  periodStart: string;
  periodEnd: string;
  callCount: number;
  ticketCount: number;
  summary: string;
  sentiment: { positive: number; negative: number; neutral: number };
  generatedAt: number;
  insights: DailyInsight[];
};
type ParsedInsightDescription = {
  submittedBy?: string;
  customer?: string;
  customerTitle?: string;
  source?: string;
  date?: string;
  productCategory?: string;
  insightCategory?: string;
  whatILearned: string;
};

type WorkflowTab = {
  status: InsightStatus;
  label: string;
};

const workflowTabs: WorkflowTab[] = [
  { status: "review", label: "Review" },
  { status: "posted", label: "Posted to Slack" },
  { status: "dismissed", label: "Dismissed" },
];

const statusClasses: Record<InsightStatus, string> = {
  review: "bg-sky-50 text-sky-700 ring-sky-200",
  posted: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  dismissed: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

const sentimentClasses: Record<InsightSentiment, string> = {
  positive: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  negative: "bg-rose-50 text-rose-700 ring-rose-200",
  neutral: "bg-amber-50 text-amber-800 ring-amber-200",
};

function parseActiveStatus({ value, isAdmin }: { value: string | null; isAdmin: boolean }): InsightStatus | null {
  if (value === "review" || value === "posted" || value === "dismissed") return value;
  if (value === "all") return null;
  return isAdmin ? "review" : null;
}

function activeStatusToParam({ status, isAdmin }: { status: InsightStatus | null; isAdmin: boolean }): string | null {
  if (status === null) return isAdmin ? "all" : null;
  if (isAdmin && status === "review") return null;
  return status;
}

function SlackLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 127 127" className={className} aria-hidden="true">
      <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A" />
      <path d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0" />
      <path d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z" fill="#2EB67D" />
      <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E" />
    </svg>
  );
}

function formatDate({ dateStr }: { dateStr: string }) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function relativeDay({ dateStr }: { dateStr: string }) {
  const then = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thatDay = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const days = Math.round((today.getTime() - thatDay.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function formatDateTime({ timestamp }: { timestamp?: number }) {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getFaviconUrl({ domain }: { domain?: string }) {
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function CompanyFavicon({ src }: { src: string }) {
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-zinc-800 ring-1 ring-zinc-900/10">
      <img src={src} alt="" className="size-3.5 object-contain" loading="lazy" />
    </span>
  );
}

function AccessMessage({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5">
      <div className="max-w-md rounded-lg bg-white p-6 text-center shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
        <h1 className="text-lg font-semibold text-zinc-950">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{message}</p>
        <Link
          href="/"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-[opacity,scale] hover:opacity-90 active:scale-[0.96]"
        >
          Back to app
        </Link>
      </div>
    </main>
  );
}

function parseInsightDescription({ description }: { description: string }): ParsedInsightDescription {
  const labels = [
    "Submitted By",
    "Customer",
    "Customer Title",
    "Source",
    "Date",
    "Product Category",
    "Insight Category",
    "What I Learned",
  ];
  const normalized = description.trim();
  const labelPattern = new RegExp(`(?:^|[\\n.,;]\\s*)(${labels.join("|")}):\\s*`, "gi");
  const matches = [...normalized.matchAll(labelPattern)];
  if (matches.length === 0) return { whatILearned: normalized };

  const values = new Map<string, string>();
  for (const [index, match] of matches.entries()) {
    const rawLabel = match[1];
    if (!rawLabel) continue;
    const valueStart = match.index! + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? normalized.length;
    const value = normalized
      .slice(valueStart, valueEnd)
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[.,;]\s*$/, "");
    if (value) values.set(rawLabel.toLowerCase(), value);
  }

  return {
    submittedBy: values.get("submitted by"),
    customer: values.get("customer"),
    customerTitle: values.get("customer title"),
    source: values.get("source"),
    date: values.get("date"),
    productCategory: values.get("product category"),
    insightCategory: values.get("insight category"),
    whatILearned: values.get("what i learned") ?? normalized,
  };
}

function InsightMetaPill({ label, value }: { label: string; value?: string }) {
  if (!value || value.toLowerCase() === "unknown") return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-600 ring-1 ring-zinc-200/80">
      <span className="shrink-0 font-medium text-zinc-400">{label}</span>
      <span className="min-w-0 truncate font-medium text-zinc-700">{value}</span>
    </span>
  );
}

function updateReportsWithInsightStatus({
  reports,
  insightId,
  status,
  dismissReason,
  now,
}: {
  reports: DailyReport[];
  insightId: Id<"dailyInsights">;
  status: InsightStatus;
  dismissReason?: string;
  now: number;
}): DailyReport[] {
  return reports.map((report) => ({
    ...report,
    insights: report.insights.map((insight) =>
      insight._id === insightId
        ? {
          ...insight,
          status,
          updatedAt: now,
          postedAt: status === "posted" ? now : insight.postedAt,
          dismissedAt: status === "dismissed" ? now : insight.dismissedAt,
          dismissReason: status === "dismissed" ? dismissReason : insight.dismissReason,
        }
        : insight
    ),
  }));
}

export default function DailyInsightsClient({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeStatus, setActiveStatusState] = useState<InsightStatus | null>(() =>
    parseActiveStatus({ value: searchParams.get("status"), isAdmin })
  );
  const selectStatus = useCallback(
    (status: InsightStatus) => {
      setActiveStatusState((current) => {
        const next = current === status ? null : status;
        const params = new URLSearchParams(searchParams.toString());
        const paramValue = activeStatusToParam({ status: next, isAdmin });
        if (paramValue === null) {
          params.delete("status");
        } else {
          params.set("status", paramValue);
        }
        const query = params.toString();
        router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
        return next;
      });
    },
    [isAdmin, pathname, router, searchParams]
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [dismissModal, setDismissModal] = useState<{ insight: DailyInsight } | null>(null);
  const reportQueryArgs = useMemo(() => ({ limit: 21, includeDismissed: isAdmin }), [isAdmin]);
  const setReviewStatusMutation = useMutation(api.dailyInsights.setReviewStatus).withOptimisticUpdate(
    (localStore, args) => {
      const currentReports = localStore.getQuery(api.dailyInsights.listDailyReports, reportQueryArgs);
      if (!currentReports) return;

      localStore.setQuery(
        api.dailyInsights.listDailyReports,
        reportQueryArgs,
        updateReportsWithInsightStatus({
          reports: currentReports,
          insightId: args.insightId,
          status: args.status,
          dismissReason: args.dismissReason,
          now: Date.now(),
        })
      );
    }
  );
  const postToSlackAction = useAction(api.dailyInsights.postToSlack);
  const getSourceDetail = useAction(api.dailyInsights.getSourceDetail);
  const addProspectMutation = useMutation(api.prospects.addManualProvisionedThroughputProspect);
  const prospectDomainList = useQuery(api.prospects.getProspectDomains, {});
  const prospectMap = useMemo(
    () => new Map((prospectDomainList ?? []).map(({ domain, companyId }) => [domain, companyId])),
    [prospectDomainList]
  );
  const liveReports = useQuery(api.dailyInsights.listDailyReports, reportQueryArgs);
  const isLoadingReports = liveReports === undefined;
  const reports = liveReports ?? [];
  const visibleWorkflowTabs = useMemo(
    () => workflowTabs.filter((tab) => isAdmin || tab.status !== "dismissed"),
    [isAdmin]
  );

  const allInsights = useMemo(
    () => reports.flatMap((report) => report.insights.map((insight) => ({ report, insight }))),
    [reports]
  );
  const counts = useMemo(
    () =>
      allInsights.reduce<Record<InsightStatus, number>>(
        (acc, item) => {
          acc[item.insight.status] += 1;
          return acc;
        },
        { review: 0, posted: 0, dismissed: 0 }
      ),
    [allInsights]
  );
  const hasVisibleInsights = activeStatus === null ? allInsights.length > 0 : counts[activeStatus] > 0;
  const activeTabLabel = workflowTabs.find((tab) => tab.status === activeStatus)?.label;

  async function setReviewStatus({
    insightId,
    status,
    dismissReason,
  }: {
    insightId: Id<"dailyInsights">;
    status: "review" | "dismissed";
    dismissReason?: string;
  }) {
    const requestKey = insightId;
    setPendingKey(requestKey);
    try {
      await setReviewStatusMutation({ insightId, status, dismissReason });
      toast.success(status === "dismissed" ? "Insight dismissed" : "Insight restored");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not update review status");
    } finally {
      setPendingKey(null);
    }
  }

  async function postToSlack({
    insight,
  }: {
    insight: DailyInsight;
  }) {
    const requestKey = insight._id;
    setPendingKey(requestKey);
    try {
      await postToSlackAction({
        insightId: insight._id,
      });
      toast.success("Posted to Slack");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not post to Slack");
    } finally {
      setPendingKey(null);
    }
  }

  async function addProspect({ insight }: { insight: DailyInsight }) {
    if (!insight.companyDomain) return;
    const requestKey = insight._id;
    setPendingKey(requestKey);
    try {
      await addProspectMutation({
        name: insight.company ?? insight.companyDomain,
        domain: insight.companyDomain,
      });
      toast.success(`${insight.company ?? insight.companyDomain} added as prospect`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not add prospect");
    } finally {
      setPendingKey(null);
    }
  }

  async function loadSource({ reference }: { reference: SourceReference }): Promise<SourceDetail | null> {
    try {
      return await getSourceDetail({
        source: reference.source,
        id: reference.id,
      });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not load source");
      return null;
    }
  }

  return (
    <>
      {isAdmin && dismissModal && (
        <DismissModal
          insight={dismissModal.insight}
          isPending={pendingKey === dismissModal.insight._id}
          onConfirm={({ dismissReason }) => {
            void setReviewStatus({ insightId: dismissModal.insight._id, status: "dismissed", dismissReason });
            setDismissModal(null);
          }}
          onCancel={() => setDismissModal(null)}
        />
      )}
      {isAdmin && (
        <section className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-[1320px] px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-zinc-400">Filter by</span>
              {visibleWorkflowTabs.map((tab) => (
                <button
                  key={tab.status}
                  type="button"
                  onClick={() => selectStatus(tab.status)}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 transition-[box-shadow,transform] active:scale-[0.96] ${statusClasses[tab.status]} ${
                    activeStatus === tab.status ? "shadow-[0_0_0_2px_rgb(24_24_27)]" : "hover:shadow-[0_0_0_1px_rgb(24_24_27/0.18)]"
                  }`}
                >
                  {tab.status === "posted" ? <SlackLogo className="size-3.5" /> : tab.status === "dismissed" ? <XIcon className="size-3.5" /> : <Clock3Icon className="size-3.5" />}
                  {tab.label}
                  <span className="tabular-nums opacity-70">{isLoadingReports ? "..." : counts[tab.status]}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto max-w-[1320px] px-4 py-5 sm:px-6 lg:px-8">
        {isLoadingReports ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 rounded-lg bg-white shadow-[inset_0_0_0_1px_rgb(228_228_231)]">
            <FileTextIcon className="size-5 text-zinc-300" />
            <p className="text-sm font-medium text-zinc-500">Loading daily reports...</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 rounded-lg bg-white shadow-[inset_0_0_0_1px_rgb(228_228_231)]">
            <FileTextIcon className="size-5 text-zinc-300" />
            <p className="text-sm font-medium text-zinc-500">No daily reports yet.</p>
          </div>
        ) : !hasVisibleInsights ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 rounded-lg bg-white shadow-[inset_0_0_0_1px_rgb(228_228_231)]">
            <FileTextIcon className="size-5 text-zinc-300" />
            <p className="text-sm font-medium text-zinc-500">
              No insights in &ldquo;{activeTabLabel}&rdquo;.
            </p>
            {activeStatus !== null && (
              <button
                type="button"
                onClick={() => selectStatus(activeStatus)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
              >
                View all insights
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {reports.map((report) => {
              const visibleInsights = isAdmin
                ? report.insights.filter((insight) => activeStatus === null || insight.status === activeStatus)
                : report.insights;
              if (visibleInsights.length === 0) return null;

              return (
                <section key={report.id} className="grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
                  <aside className="md:sticky md:top-[117px] md:self-start">
                    <div className="rounded-lg bg-white p-3 shadow-[0_0_0_1px_rgb(228_228_231),0_1px_2px_rgb(24_24_27/0.04)]">
                      <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400">
                        <CalendarDaysIcon className="size-3.5" />
                        {relativeDay({ dateStr: report.periodStart })}
                      </div>
                      <p className="mt-1 text-lg font-semibold tracking-tight text-zinc-950">
                        {formatDate({ dateStr: report.periodStart })}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{report.summary}</p>
                      <div className="mt-3 grid grid-cols-3 gap-1 text-center">
                        <MiniMetric value={String(visibleInsights.length)} label="items" />
                        <MiniMetric value={String(report.callCount)} label="calls" />
                        <MiniMetric value={String(report.ticketCount)} label="tickets" />
                      </div>
                    </div>
                  </aside>

                  <div className="overflow-hidden rounded-lg bg-white shadow-[0_0_0_1px_rgb(228_228_231),0_1px_2px_rgb(24_24_27/0.04)]">
                  {visibleInsights.map((insight) => {
                    const faviconUrl = getFaviconUrl({ domain: insight.companyDomain });
                    const requestKey = insight._id;
                    const isPending = pendingKey === requestKey;
                    const postedAt = formatDateTime({ timestamp: insight.postedAt });
                    const dismissedAt = formatDateTime({ timestamp: insight.dismissedAt });
                    const parsedDescription = parseInsightDescription({ description: insight.description });

                    return (
                      <article key={insight.highlightKey} className="border-b border-zinc-200 px-4 py-4 last:border-b-0 sm:px-5">
                        <div className="flex flex-wrap items-center gap-2">
                          {faviconUrl && <CompanyFavicon src={faviconUrl} />}
                          {insight.companyDomain && !isPlaceholderDomain({ domain: insight.companyDomain }) ? (
                            <Link
                              href={`/companies/${encodeURIComponent(insight.companyDomain)}`}
                              className="text-sm font-semibold text-zinc-950 hover:text-zinc-700 hover:underline underline-offset-2"
                            >
                              {insight.company ?? insight.companyDomain}
                            </Link>
                          ) : (
                            <span className="text-sm font-semibold text-zinc-950">{insight.company ?? insight.companyDomain ?? "Customer signal"}</span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${sentimentClasses[insight.sentiment]}`}>
                            {insight.sentiment}
                          </span>
                          {isAdmin && insight.status === "dismissed" && insight.dismissReason ? (
                            <span className="group relative">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${statusClasses[insight.status]}`}>
                                Dismissed
                                <svg viewBox="0 0 16 16" className="size-3 shrink-0 opacity-60" fill="currentColor" aria-hidden="true">
                                  <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                                  <rect x="7.25" y="7" width="1.5" height="4.5" rx="0.5" />
                                  <circle cx="8" cy="5" r="0.85" />
                                </svg>
                              </span>
                              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                {insight.dismissReason}
                                <span className="absolute -top-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-b-zinc-900" />
                              </span>
                            </span>
                          ) : (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${statusClasses[insight.status]}`}>
                              {insight.status === "posted" ? "Posted to Slack" : insight.status === "dismissed" ? "Dismissed" : "Review"}
                            </span>
                          )}
                          {postedAt && <span className="text-xs text-zinc-400">Posted {postedAt}</span>}
                          {isAdmin && dismissedAt && <span className="text-xs text-zinc-400">Dismissed {dismissedAt}</span>}
                        </div>
                        <div className="mt-3 border-l-2 border-zinc-200 pl-3">
                          <h3 className="text-[17px] font-semibold leading-6 tracking-tight text-zinc-950">{insight.title}</h3>
                          <p className="mt-2 text-[15px] leading-6 text-zinc-700">{parsedDescription.whatILearned}</p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <InsightMetaPill label="Submitted by" value={parsedDescription.submittedBy} />
                            <InsightMetaPill label="Title" value={parsedDescription.customerTitle} />
                            <InsightMetaPill label="Product" value={parsedDescription.productCategory} />
                            <InsightMetaPill label="Category" value={parsedDescription.insightCategory} />
                            <InsightMetaPill label="Date" value={parsedDescription.date} />
                            <InsightMetaPill label="Source" value={parsedDescription.source} />
                          </div>
                        </div>
                        {insight.sourceRefs && insight.sourceRefs.length > 0 && (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {insight.sourceRefs.map((source) => (
                              <SourceViewer
                                key={`${source.source}:${source.id}`}
                                reference={source}
                                mode="button"
                                loadSource={loadSource}
                              />
                            ))}
                          </div>
                        )}
                        {isAdmin && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {insight.status === "review" ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => postToSlack({ insight })}
                                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-zinc-950 transition-[background-color,transform] hover:bg-zinc-100 active:scale-[0.96] disabled:opacity-50"
                                >
                                  <SlackLogo />
                                  Post to Slack
                                </button>
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => setDismissModal({ insight })}
                                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-zinc-400 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.96] disabled:opacity-50"
                                >
                                  <XIcon className="size-3.5" />
                                  Dismiss
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => setReviewStatus({ insightId: insight._id, status: "review" })}
                                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-zinc-950 transition-[background-color,transform] hover:bg-zinc-100 active:scale-[0.96] disabled:opacity-50"
                                >
                                  {insight.status === "posted" ? <CheckIcon className="size-3.5" /> : <RotateCcwIcon className="size-3.5" />}
                                  Restore to review
                                </button>
                                {insight.status === "posted" && (
                                  <button
                                    type="button"
                                    disabled={isPending}
                                    onClick={() => setDismissModal({ insight })}
                                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-zinc-400 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.96] disabled:opacity-50"
                                  >
                                    <XIcon className="size-3.5" />
                                    Dismiss
                                  </button>
                                )}
                              </>
                            )}
                            {insight.companyDomain && (
                              prospectMap.has(insight.companyDomain) ? (
                                <Link
                                  href={`/prospects?client=${prospectMap.get(insight.companyDomain)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-zinc-400 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.96]"
                                >
                                  View Prospect
                                  <ArrowRightIcon className="size-3.5" />
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => addProspect({ insight })}
                                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-zinc-400 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-700 active:scale-[0.96] disabled:opacity-50"
                                >
                                  <PlusIcon className="size-3.5" />
                                  Add Prospect
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function MiniMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md bg-zinc-50 px-1.5 py-1.5">
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] text-zinc-500">{label}</p>
    </div>
  );
}

const DISMISS_REASONS = [
  "Not actionable right now",
  "Already known / tracked elsewhere",
  "Duplicate insight",
  "Incorrect data or wrong company",
  "Too vague",
];

function DismissModal({
  insight,
  isPending,
  onConfirm,
  onCancel,
}: {
  insight: DailyInsight;
  isPending: boolean;
  onConfirm: ({ dismissReason }: { dismissReason: string }) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);

  const effectiveReason = selected === "Other" ? other.trim() : (selected ?? "");
  const canSubmit = effectiveReason.length > 0 && !isPending;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === backdropRef.current) onCancel(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200">
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">Why are you dismissing this?</h2>
              <p className="mt-0.5 text-sm text-zinc-500 line-clamp-1">{insight.title}</p>
            </div>
            <button
              type="button"
              aria-label="Cancel"
              onClick={onCancel}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>
        <div className="px-5 py-4 space-y-2">
          {DISMISS_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => setSelected(reason)}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ring-1 ${
                selected === reason
                  ? "bg-zinc-950 text-white ring-zinc-950"
                  : "bg-zinc-50 text-zinc-700 ring-zinc-200 hover:bg-zinc-100"
              }`}
            >
              {reason}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelected("Other")}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ring-1 ${
              selected === "Other"
                ? "bg-zinc-950 text-white ring-zinc-950"
                : "bg-zinc-50 text-zinc-700 ring-zinc-200 hover:bg-zinc-100"
            }`}
          >
            Other
          </button>
          {selected === "Other" && (
            <textarea
              autoFocus
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Describe why this insight isn't useful…"
              rows={3}
              className="mt-1 w-full resize-none rounded-lg bg-zinc-50 px-3 py-2.5 text-sm text-zinc-950 ring-1 ring-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950"
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-9 items-center rounded-full px-4 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm({ dismissReason: effectiveReason })}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-zinc-950 px-4 text-sm font-medium text-white transition-[background-color,transform,opacity] hover:bg-zinc-800 active:scale-[0.96] disabled:opacity-40"
          >
            <XIcon className="size-3.5" />
            Dismiss insight
          </button>
        </div>
      </div>
    </div>
  );
}
