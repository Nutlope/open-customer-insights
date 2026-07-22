import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { ActivityIcon, BookmarkIcon, MonitorIcon, PlayIcon, RepeatIcon, SearchIcon, ServerIcon, UsersIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ComponentType } from "react";
import { api } from "@/convex/_generated/api";
import { APP_NAME } from "@/lib/constants";
import type { SavedQueryAdminSummary, SavedQueryAdminUser } from "@/lib/convex/savedQueryUsage";
import type { UsageSummary, UsageSummaryUser } from "@/lib/convex/usage";
import { DauChart } from "./DauChart";

type AdminTab = "usage" | "saved-queries";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function getSearchParam({
  value,
}: {
  value?: string | string[];
}): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDate({ timestamp }: { timestamp: number | null }): string {
  if (timestamp === null) return "No usage";
  return dateFormatter.format(new Date(timestamp));
}

function getAdminHref({
  tab,
  userId,
  selectedWeek,
}: {
  tab: AdminTab;
  userId: string;
  selectedWeek: string;
}): string {
  const params = new URLSearchParams();
  if (tab !== "usage") params.set("tab", tab);
  if (userId) params.set("userId", userId);
  if (selectedWeek) params.set("week", selectedWeek);
  const qs = params.toString();
  return `/admin${qs ? `?${qs}` : ""}`;
}

function getAdminTab({ value }: { value: string }): AdminTab {
  return value === "saved-queries" ? "saved-queries" : "usage";
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg bg-white px-3 py-3 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
        <Icon className="size-3.5 text-zinc-400" />
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-normal text-zinc-950 tabular-nums">{value}</div>
      <div className="mt-0.5 hidden text-[11px] text-zinc-400 sm:block">{detail}</div>
    </div>
  );
}

function UsageBar({ user }: { user: UsageSummaryUser }) {
  const chatWidth = `${user.chatPercent}%`;
  const mcpWidth = `${user.mcpPercent}%`;

  return (
    <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
      <div className="flex h-full">
        <div className="bg-emerald-500" style={{ width: chatWidth }} />
        <div className="bg-sky-500" style={{ width: mcpWidth }} />
      </div>
    </div>
  );
}

function UserUsageRow({ user }: { user: UsageSummaryUser }) {
  return (
    <Link
      href={`/admin/users/${user.userId}`}
      className="block rounded-lg bg-white px-4 py-3 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)] transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[0_1px_0_rgba(24,24,27,0.08),0_12px_30px_rgba(24,24,27,0.08)]"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[minmax(0,1fr)_200px_140px] sm:items-center">
        {/* Identity */}
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-950">{user.name}</h2>
            {user.email && <span className="hidden truncate text-xs text-zinc-400 sm:inline">{user.email}</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-400 sm:hidden">{user.email}</div>
          <div className="mt-1 hidden min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-300 sm:flex">
            <span className="truncate">{user.userId}</span>
            <span className="truncate">{user.clerkId}</span>
          </div>
        </div>

        {/* Counts — always visible, compact */}
        <div className="grid grid-cols-3 gap-2 tabular-nums sm:col-start-3">
          <div className="text-right sm:text-left">
            <div className="text-[11px] font-medium text-zinc-400">Total</div>
            <div className="text-sm font-semibold text-zinc-950">{user.total.toLocaleString()}</div>
          </div>
          <div className="text-right sm:text-left">
            <div className="text-[11px] font-medium text-zinc-400">Web</div>
            <div className="text-sm font-semibold text-emerald-700">{user.chat.toLocaleString()}</div>
          </div>
          <div className="text-right sm:text-left">
            <div className="text-[11px] font-medium text-zinc-400">MCP</div>
            <div className="text-sm font-semibold text-sky-700">{user.mcp.toLocaleString()}</div>
          </div>
        </div>

        {/* Usage bar — hidden on mobile */}
        <div className="col-start-1 hidden sm:col-start-2 sm:block">
          <div className="mb-1.5 flex justify-between text-[11px] text-zinc-400">
            <span>Web {user.chatPercent}%</span>
            <span>MCP {user.mcpPercent}%</span>
          </div>
          <UsageBar user={user} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
        <span>Last used {formatDate({ timestamp: user.lastUsedAt })}</span>
        <span className="hidden sm:inline">First used {formatDate({ timestamp: user.firstUsedAt })}</span>
        {user.other > 0 && <span>+{user.other.toLocaleString()} other</span>}
      </div>
    </Link>
  );
}

function AdminTabs({
  activeTab,
  userId,
  selectedWeek,
}: {
  activeTab: AdminTab;
  userId: string;
  selectedWeek: string;
}) {
  const tabs: Array<{ tab: AdminTab; label: string }> = [
    { tab: "usage", label: "Usage" },
    { tab: "saved-queries", label: "Saved queries" },
  ];

  return (
    <nav className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1">
      {tabs.map((item) => {
        const isActive = activeTab === item.tab;
        return (
          <Link
            key={item.tab}
            href={getAdminHref({ tab: item.tab, userId, selectedWeek })}
            className={`inline-flex h-8 items-center justify-center rounded-md px-3 font-mono text-xs font-medium transition-[background-color,color,box-shadow] ${
              isActive
                ? "bg-white text-zinc-950 shadow-[0_1px_0_rgba(24,24,27,0.08)]"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SavedQueryUserRow({ user }: { user: SavedQueryAdminUser }) {
  return (
    <div className="rounded-lg bg-white px-4 py-3 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-950">{user.name}</h2>
            {user.email && <span className="hidden truncate text-xs text-zinc-400 sm:inline">{user.email}</span>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-400 sm:hidden">{user.email}</div>
          <div className="mt-1 hidden min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-300 sm:flex">
            <span className="truncate">{user.userId}</span>
            <span className="truncate">{user.clerkId}</span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 tabular-nums">
          <div>
            <div className="text-[11px] font-medium text-zinc-400">Saved</div>
            <div className="text-sm font-semibold text-zinc-950">{user.savedQueryCount.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-zinc-400">Runs</div>
            <div className="text-sm font-semibold text-emerald-700">{user.totalRunCount.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-zinc-400">This week</div>
            <div className="text-sm font-semibold text-sky-700">{user.runsInPeriod.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-zinc-400">Repeated</div>
            <div className="text-sm font-semibold text-amber-700">{user.repeatedQueries.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 divide-y divide-zinc-100">
        {user.queries.slice(0, 8).map((query) => (
          <div key={query.savedQueryId} className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-zinc-800">{query.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-zinc-400">{query.query}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums text-zinc-500">
              <span>{query.runCount.toLocaleString()} runs</span>
              <span>{query.runsInPeriod.toLocaleString()} in period</span>
              <span>{formatDate({ timestamp: query.lastRunAt })}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageTabContent({
  summary,
  userId,
  selectedWeek,
}: {
  summary: UsageSummary;
  userId: string;
  selectedWeek: string;
}) {
  return (
    <>
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DauChart data={summary.weeklyActiveUsers} selectedWeek={selectedWeek || undefined} userId={userId} />
        <div className="grid grid-cols-2 content-start gap-3">
          <Metric icon={ActivityIcon} label="Total usage" value={summary.total.toLocaleString()} detail={selectedWeek ? `Week of ${selectedWeek}` : "Tracked app events"} />
          <Metric icon={MonitorIcon} label="Web app" value={`${summary.chatPercent}%`} detail={`${summary.chat.toLocaleString()} chat requests`} />
          <Metric icon={ServerIcon} label="MCP" value={`${summary.mcpPercent}%`} detail={`${summary.mcp.toLocaleString()} MCP auth events`} />
          <Metric icon={UsersIcon} label="Users" value={summary.uniqueUsers.toLocaleString()} detail="With tracked usage" />
        </div>
      </section>

      <section className="mt-5 space-y-3">
        {selectedWeek && (
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-zinc-500">
              Showing users active week of <span className="font-semibold text-zinc-700">{selectedWeek}</span>
            </p>
            <Link
              href={getAdminHref({ tab: "usage", userId, selectedWeek: "" })}
              className="font-mono text-xs text-zinc-400 transition-colors hover:text-zinc-700"
            >
              show all weeks
            </Link>
          </div>
        )}
        {summary.users.length > 0 ? (
          summary.users.map((user) => <UserUsageRow key={user.userId} user={user} />)
        ) : (
          <div className="rounded-lg bg-white px-4 py-10 text-center shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
            <h2 className="text-sm font-semibold text-zinc-950">No usage found</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {selectedWeek ? "No users were active this week." : "Try a different user id, Clerk id, name, or email."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function SavedQueriesTabContent({
  summary,
  userId,
  selectedWeek,
}: {
  summary: SavedQueryAdminSummary;
  userId: string;
  selectedWeek: string;
}) {
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={BookmarkIcon} label="Saved queries" value={summary.totalSavedQueries.toLocaleString()} detail={selectedWeek ? `${summary.savedQueriesCreatedInPeriod.toLocaleString()} created this week` : "Current saved queries"} />
        <Metric icon={PlayIcon} label="Runs" value={summary.totalRunCount.toLocaleString()} detail={selectedWeek ? `${summary.runsInPeriod.toLocaleString()} runs this week` : "Tracked executions"} />
        <Metric icon={UsersIcon} label="Users" value={summary.usersWithSavedQueries.toLocaleString()} detail={`${summary.usersWithRunsInPeriod.toLocaleString()} ran saved queries in period`} />
        <Metric icon={RepeatIcon} label="Repeated" value={summary.repeatedQueries.toLocaleString()} detail="Saved queries run more than once" />
      </section>

      <section className="mt-5 space-y-3">
        {selectedWeek && (
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-zinc-500">
              Showing saved-query activity week of <span className="font-semibold text-zinc-700">{selectedWeek}</span>
            </p>
            <Link
              href={getAdminHref({ tab: "saved-queries", userId, selectedWeek: "" })}
              className="font-mono text-xs text-zinc-400 transition-colors hover:text-zinc-700"
            >
              show all weeks
            </Link>
          </div>
        )}
        {summary.users.length > 0 ? (
          summary.users.map((user) => <SavedQueryUserRow key={user.userId} user={user} />)
        ) : (
          <div className="rounded-lg bg-white px-4 py-10 text-center shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
            <h2 className="text-sm font-semibold text-zinc-950">No saved queries found</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {selectedWeek ? "No saved queries were created or run this week." : "Try a different user id, Clerk id, name, or email."}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function UsagePageContent({
  summary,
  savedQuerySummary,
  activeTab,
  userId,
  selectedWeek,
}: {
  summary: UsageSummary;
  savedQuerySummary: SavedQueryAdminSummary;
  activeTab: AdminTab;
  userId: string;
  selectedWeek: string;
}) {
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Image src="/icon.png" alt="Customer Insights" width={28} height={28} className="size-7 rounded-lg" />
          <span className="hidden font-mono text-xs font-medium text-zinc-400 sm:inline">{APP_NAME}</span>
        </Link>
        <span className="hidden font-mono text-xs text-zinc-300 sm:inline">/</span>
        <span className="font-mono text-xs font-medium text-zinc-500">admin</span>
        <Link
          href="/admin/acr-suggestions"
          className="font-mono text-xs text-zinc-400 transition-colors hover:text-zinc-700"
        >
          acr-suggestions
        </Link>

        <form action="/admin" className="ml-auto flex items-center gap-2">
          {activeTab !== "usage" && <input type="hidden" name="tab" value={activeTab} />}
          {selectedWeek && <input type="hidden" name="week" value={selectedWeek} />}
          <label className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              name="userId"
              defaultValue={userId}
              placeholder="Search…"
              className="h-8 w-32 rounded-md border border-zinc-200 bg-zinc-50 pl-8 pr-3 font-mono text-xs text-zinc-950 outline-none transition-[width,box-shadow,border-color] placeholder:text-zinc-400 focus:w-48 focus:border-zinc-400 focus:bg-white focus:shadow-[0_0_0_2px_rgba(14,165,233,0.15)] sm:w-44 sm:focus:w-56"
            />
          </label>
          <button className="h-8 rounded-md bg-zinc-950 px-3 font-mono text-xs font-medium text-white transition-[opacity,scale] hover:opacity-80 active:scale-[0.97]">
            Filter
          </button>
          {(userId || selectedWeek) && (
            <Link
              href={getAdminHref({ tab: activeTab, userId: "", selectedWeek: "" })}
              className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 font-mono text-xs font-medium text-zinc-600 transition-[background-color,scale] hover:bg-zinc-100 active:scale-[0.97]"
            >
              Clear
            </Link>
          )}
        </form>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-5 sm:py-6">
        <AdminTabs activeTab={activeTab} userId={userId} selectedWeek={selectedWeek} />
        {activeTab === "saved-queries" ? (
          <SavedQueriesTabContent summary={savedQuerySummary} userId={userId} selectedWeek={selectedWeek} />
        ) : (
          <UsageTabContent summary={summary} userId={userId} selectedWeek={selectedWeek} />
        )}
      </div>
    </main>
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

export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams?: Promise<{ userId?: string | string[]; week?: string | string[]; tab?: string | string[] }>;
}) {
  const { userId, getToken } = await auth();
  if (!userId) {
    return <AccessMessage title="Sign in required" message="Sign in before opening the usage admin page." />;
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    return <AccessMessage title="Convex auth unavailable" message="Could not get a Convex token for this session." />;
  }

  const params = await searchParams;
  const userFilter = getSearchParam({ value: params?.userId });
  const weekFilter = getSearchParam({ value: params?.week });
  const activeTab = getAdminTab({ value: getSearchParam({ value: params?.tab }) });
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);

  try {
    const [summary, savedQuerySummary] = await Promise.all([
      convex.query(api.users.getUsageSummary, {
        userId: userFilter || undefined,
        weekFilter: weekFilter || undefined,
      }),
      convex.query(api.savedQueries.getAdminSummary, {
        userId: userFilter || undefined,
        weekFilter: weekFilter || undefined,
      }),
    ]);
    return (
      <UsagePageContent
        activeTab={activeTab}
        savedQuerySummary={savedQuerySummary}
        summary={summary}
        userId={userFilter}
        selectedWeek={weekFilter}
      />
    );
  } catch {
    return <AccessMessage title="Admin access required" message="Your account is not allowed to view usage analytics." />;
  }
}
