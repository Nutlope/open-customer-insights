import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { ArrowLeftIcon, ExternalLinkIcon, MessageSquareIcon, ServerIcon } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate({ timestamp }: { timestamp: number }): string {
  return dateFormatter.format(new Date(timestamp));
}

type QueryHistoryItem = {
  _id: string;
  channel: "chat" | "mcp" | "slack";
  query: string;
  threadId?: string;
  source?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  timestamp: number;
};

type ChatThreadItem = {
  threadId: string;
  title: string;
  summary?: string;
  createdAt: number;
};

type WeeklyHistoryGroup = {
  key: string;
  label: string;
  queries: QueryHistoryItem[];
  threads: ChatThreadItem[];
};

function weekStartKey({ timestamp }: { timestamp: number }): string {
  const date = new Date(timestamp);
  const dayOfWeek = date.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysToMonday));
  return monday.toISOString().slice(0, 10);
}

function formatWeekLabel({ weekStart }: { weekStart: string }): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const formatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function getOrCreateWeekGroup({
  groups,
  timestamp,
}: {
  groups: Map<string, WeeklyHistoryGroup>;
  timestamp: number;
}): WeeklyHistoryGroup {
  const key = weekStartKey({ timestamp });
  const existing = groups.get(key);
  if (existing) return existing;
  const group = {
    key,
    label: formatWeekLabel({ weekStart: key }),
    queries: [],
    threads: [],
  };
  groups.set(key, group);
  return group;
}

function groupHistoryByWeek({
  queries,
  threads,
}: {
  queries: QueryHistoryItem[];
  threads: ChatThreadItem[];
}): WeeklyHistoryGroup[] {
  const groups = new Map<string, WeeklyHistoryGroup>();
  for (const query of queries) {
    getOrCreateWeekGroup({ groups, timestamp: query.timestamp }).queries.push(query);
  }
  for (const thread of threads) {
    getOrCreateWeekGroup({ groups, timestamp: thread.createdAt }).threads.push(thread);
  }
  return [...groups.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function getDisplayName({
  user,
}: {
  user: { name?: string; email: string; clerkId: string };
}): string {
  if (user.name?.trim()) return user.name.trim();
  if (user.email.trim()) return user.email.split("@")[0] ?? user.email;
  return user.clerkId;
}

function AccessMessage({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-5">
      <div className="max-w-md rounded-lg bg-white p-6 text-center shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
        <h1 className="text-lg font-semibold text-zinc-950">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{message}</p>
        <Link
          href="/admin"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-[opacity,scale] hover:opacity-90 active:scale-[0.96]"
        >
          Back to admin
        </Link>
      </div>
    </main>
  );
}

export default async function AdminUserQueriesPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId: adminClerkId, getToken } = await auth();
  if (!adminClerkId) {
    return <AccessMessage title="Sign in required" message="Sign in before opening user query history." />;
  }

  const token = await getToken({ template: "convex" });
  if (!token) {
    return <AccessMessage title="Convex auth unavailable" message="Could not get a Convex token for this session." />;
  }

  const { userId } = await params;
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);

  try {
    const history = await convex.query(api.users.getUserQueryHistory, {
      userId: userId as Id<"users">,
      limit: 200,
    });
    const name = getDisplayName({ user: history.user });
    const weeklyGroups = groupHistoryByWeek({
      queries: history.queries as QueryHistoryItem[],
      threads: history.threads as ChatThreadItem[],
    });

    return (
      <main className="min-h-screen bg-zinc-50 text-zinc-950">
        <header className="flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4">
          <Link
            href="/admin"
            className="inline-flex size-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-[background-color,color] hover:bg-zinc-100 hover:text-zinc-950"
            aria-label="Back to admin"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-zinc-950">{name}</h1>
            <p className="truncate text-xs text-zinc-400">{history.user.email || history.user.clerkId}</p>
          </div>
        </header>

        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-5 sm:py-6">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">Activity</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                Showing {history.queries.length.toLocaleString()} recorded prompt{history.queries.length === 1 ? "" : "s"} and {history.threads.length.toLocaleString()} chat thread{history.threads.length === 1 ? "" : "s"}, grouped by week.
              </p>
            </div>
          </div>

          {weeklyGroups.length > 0 ? (
            <section className="space-y-5">
              {weeklyGroups.map((group) => (
                <section key={group.key} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3 px-1">
                    <h3 className="text-sm font-semibold text-zinc-950">{group.label}</h3>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {group.queries.length} prompt{group.queries.length === 1 ? "" : "s"} · {group.threads.length} thread{group.threads.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  {group.threads.length > 0 && (
                    <div className="rounded-lg bg-white px-3 py-2 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Chat threads</div>
                      <div className="space-y-1">
                        {group.threads.map((thread) => (
                          <Link
                            key={thread.threadId}
                            href={`/chat/${thread.threadId}`}
                            className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-zinc-700 transition-[background-color,color] hover:bg-zinc-50 hover:text-zinc-950"
                          >
                            <span className="min-w-0 truncate">{thread.title}</span>
                            <ExternalLinkIcon className="size-3.5 shrink-0 text-zinc-400" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    {group.queries.map((query) => (
                      <article
                        key={query._id}
                        className="rounded-lg bg-white px-4 py-3 shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 font-medium text-zinc-600">
                            {query.channel === "chat" ? <MessageSquareIcon className="size-3.5" /> : <ServerIcon className="size-3.5" />}
                            {query.channel === "chat" ? "Chat" : query.channel.toUpperCase()}
                          </span>
                          <span>{formatDate({ timestamp: query.timestamp })}</span>
                          {query.source && <span>Source {query.source}</span>}
                          {query.fromDate && <span>From {query.fromDate}</span>}
                          {query.toDate && <span>To {query.toDate}</span>}
                          {query.limit && <span>Limit {query.limit}</span>}
                          {query.threadId && (
                            <Link
                              href={`/chat/${query.threadId}`}
                              className="inline-flex items-center gap-1 rounded-md bg-zinc-950 px-2 py-1 font-medium text-white transition-[background-color,transform] hover:bg-zinc-800 active:scale-[0.97]"
                            >
                              Open thread
                              <ExternalLinkIcon className="size-3" />
                            </Link>
                          )}
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-950">{query.query}</p>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </section>
          ) : (
            <div className="rounded-lg bg-white px-4 py-10 text-center shadow-[0_1px_0_rgba(24,24,27,0.08),0_8px_24px_rgba(24,24,27,0.04)]">
              <h2 className="text-sm font-semibold text-zinc-950">No queries recorded yet</h2>
              <p className="mt-1 text-sm text-zinc-500">Query text is recorded for new chat prompts and MCP searches.</p>
            </div>
          )}
        </div>
      </main>
    );
  } catch {
    return <AccessMessage title="Admin access required" message="Your account is not allowed to view user query history." />;
  }
}
