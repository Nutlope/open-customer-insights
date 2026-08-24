"use client";

import { useSmoothText, useUIMessages } from "@convex-dev/agent/react";
import { useUser } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  ArrowUpIcon,
  BookmarkIcon,
  CopyIcon,
  MenuIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PencilIcon,
  PlusIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import ChatErrorBoundary from "./ChatErrorBoundary";
import ChatSuggestions from "./ChatSuggestions";
import ChatWelcome, { type ChatWelcomeStats } from "./ChatWelcome";
import { SourceIcon, type SourceVisualKey } from "./sourceVisuals";
import {
  getPreOutputThinkingParts,
  getResolvedModelLabel,
  getVisibleTextParts,
  ThinkingSteps,
  type ChatMessagePart,
} from "./ChatThinking";
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL_SELECTION,
  isChatModelSelection,
  type ChatModelSelection,
} from "@/lib/chat/models";

type SavedQuery = Doc<"savedQueries">;
type StagedSavedQuery = {
  savedQueryId: Id<"savedQueries">;
  query: string;
};
type RecentThread = {
  threadId: string;
  title: string;
  createdAt: number;
  summary?: string;
};
/* Rendered locally the instant the user submits, before the server has
   created the thread or echoed the message back. baselineOrder is the
   highest message `order` present at submit time: anything with a greater
   order belongs to this turn. Order is intrinsic to each message, so the
   comparison stays correct even while the merged subscription list drops
   and reinserts entries during reconciliation (an index-based baseline
   drifted when that happened, letting old messages masquerade as the
   reply). */
type OptimisticPrompt = {
  text: string;
  baselineOrder: number;
  threadId?: string;
};
type ResolvedChatModel = {
  modelId: string;
  label: string;
};
type ChatUiMessageModelFields = {
  resolvedModel?: ResolvedChatModel;
};

const PENDING_SAVED_QUERY_DRAFT_KEY = "customer-insights.pendingSavedQueryDraft";
const PENDING_SAVED_QUERY_RUN_KEY = "customer-insights.pendingSavedQueryRun";

function resolvedModelForMessage({
  message,
  parts,
}: {
  message: unknown;
  parts: ChatMessagePart[];
}): string | null {
  const resolved = (message as ChatUiMessageModelFields).resolvedModel;
  return resolved?.label ?? getResolvedModelLabel({ parts });
}

/* Convex delivers stream deltas in throttled batches, so rendering them raw
   makes text pop in chunks. useSmoothText replays the incoming text at an
   adaptive per-character rate, and the word-level fade in MessageResponse
   rides on top of that steady flow. */
function AssistantAnswerText({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const [visibleText, { isStreaming: isCatchingUp }] = useSmoothText(text, {
    startStreaming: isStreaming,
  });
  return (
    <MessageResponse isAnimating={isStreaming || isCatchingUp}>
      {visibleText}
    </MessageResponse>
  );
}

function relativeTime({ date }: { date: string }): string {
  const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

type SidebarDatasetItem = {
  count?: number;
  detail?: string;
  href?: string;
  label: string;
  source: SourceVisualKey;
};

function sidebarDatasetItems({
  stats,
}: {
  stats?: ChatWelcomeStats | null;
}): SidebarDatasetItem[] {
  const lastCallDate = stats?.recentCalls?.[0]?.date;
  const lastTicketDate = stats?.recentTickets?.[0]?.date;
  const { chunksTotal, chunksEmbedded } = stats ?? {};
  const embedPct = chunksTotal !== undefined && chunksEmbedded !== undefined && chunksTotal > 0
    ? Math.round((chunksEmbedded / chunksTotal) * 100)
    : undefined;

  const items: Array<SidebarDatasetItem | undefined> = [
    {
      count: stats?.callsCount,
      detail: [
        lastCallDate ? `Latest synced ${relativeTime({ date: lastCallDate })}` : undefined,
        embedPct !== undefined && embedPct < 100 ? `${embedPct}% embedded` : undefined,
      ].filter((part): part is string => Boolean(part)).join(" · ") || undefined,
      label: "calls",
      source: "calls",
    },
    {
      count: stats?.issuesCount,
      detail: lastTicketDate ? `Latest synced ${relativeTime({ date: lastTicketDate })}` : undefined,
      label: "tickets",
      source: "tickets",
    },
    { count: stats?.slackChannelsCount, label: "slack channels", source: "slack" },
    { count: stats?.companiesCount, href: "/companies", label: "companies", source: "companies" },
  ];

  return items.filter((item): item is SidebarDatasetItem => item !== undefined && item.count !== undefined);
}

function SidebarMetadataFooter({
  stats,
}: {
  stats?: ChatWelcomeStats | null;
}) {
  const datasetItems = sidebarDatasetItems({ stats });
  if (datasetItems.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-zinc-200/80 px-4 py-3">
      <div className="flex flex-wrap gap-1.5">
        {datasetItems.map((item) => {
          const count = item.count;
          if (count === undefined) return null;
          const label = `${count.toLocaleString()} ${item.label}`;
          const className = "group relative inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full bg-white/70 px-2 py-1 text-2xs font-medium leading-4 text-zinc-500 border border-zinc-200 transition-[background-color,color,box-shadow] hover:bg-white hover:text-zinc-800 hover:border-zinc-300 focus-visible:bg-white focus-visible:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300";
          const content = (
            <>
              <SourceIcon source={item.source} />
              <span>{label}</span>
              {item.detail && (
                <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 whitespace-nowrap rounded-md bg-zinc-950 px-2 py-1 text-2xs font-medium leading-4 text-white opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:-translate-y-0.5 group-hover:opacity-100 group-focus-visible:-translate-y-0.5 group-focus-visible:opacity-100">
                  {item.detail}
                </span>
              )}
            </>
          );

          return item.href ? (
            <Link key={item.source} href={item.href} className={className}>
              {content}
            </Link>
          ) : (
            <span key={item.source} tabIndex={item.detail ? 0 : undefined} className={className}>
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function ChatDemo({
  compact = false,
  draftPrompt,
  stats,
  threadId,
}: {
  compact?: boolean;
  draftPrompt?: {
    id: string;
    text: string;
  } | null;
  stats?: ChatWelcomeStats | null;
  threadId?: string;
}) {
  return (
    <ChatErrorBoundary>
      <ChatInterface compact={compact} draftPrompt={draftPrompt} stats={stats} threadId={threadId} />
    </ChatErrorBoundary>
  );
}

function ChatInterface({
  compact,
  draftPrompt,
  stats,
  threadId,
}: {
  compact: boolean;
  draftPrompt?: {
    id: string;
    text: string;
  } | null;
  stats?: ChatWelcomeStats | null;
  threadId?: string;
}) {
  const [selectedModelId, setSelectedModelId] = useState<ChatModelSelection>(
    DEFAULT_CHAT_MODEL_SELECTION
  );
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>(threadId);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [optimisticPrompt, setOptimisticPrompt] = useState<OptimisticPrompt | null>(null);
  const [stagedSavedQuery, setStagedSavedQuery] = useState<StagedSavedQuery | null>(null);
  const router = useRouter();
  const { user, isLoaded: isUserLoaded } = useUser();
  const {
    results: messages,
    status: messagesStatus,
  } = useUIMessages(
    api.chatThreads.listMessages,
    activeThreadId ? { threadId: activeThreadId } : "skip",
    { initialNumItems: 100, stream: true }
  );
  const savedQueries = useQuery(api.savedQueries.list);
  const recentThreads = useQuery(api.chatThreads.listMine, { limit: 20 });
  const submitMessageAction = useAction(api.chatThreads.submit);
  const abortThreadMutation = useMutation(api.chatThreads.abort);
  const archiveThreadMutation = useMutation(api.chatThreads.archive);
  const saveQueryMutation = useMutation(api.savedQueries.save);
  const markSavedQueryRunMutation = useMutation(api.savedQueries.markRun);
  const renameSavedQueryMutation = useMutation(api.savedQueries.rename);
  const removeSavedQueryMutation = useMutation(api.savedQueries.remove);
  const selectedModel = CHAT_MODEL_OPTIONS.find((model) => model.id === selectedModelId);
  const hasStreamingMessage = messages.some(
    (message) => message.status === "pending" || message.status === "streaming"
  );
  /* Everything below derives from the sticky optimisticPrompt state rather
     than from the raw subscription, because the merged message list flaps
     while stream deltas and persisted messages reconcile: records and their
     parts can appear, drop, and reappear across a few frames. Deriving the
     placeholder from those raw signals is what made the Thinking indicator
     blink after sending. The turn is only considered answered once an
     assistant message after the submit baseline has real content (or has
     settled empty, e.g. an abort). */
  const messagesAfterBaseline = optimisticPrompt
    ? messages.filter(
        (message) => (message.order ?? -1) > optimisticPrompt.baselineOrder
      )
    : [];
  const hasUserMessageAfterBaseline = messagesAfterBaseline.some(
    (message) => message.role === "user"
  );
  const assistantContentAfterBaseline = messagesAfterBaseline.some((message) => {
    if (message.role !== "assistant") return false;
    const parts = message.parts as ChatMessagePart[];
    return (
      getPreOutputThinkingParts({ parts }).length > 0 ||
      getVisibleTextParts({ messageRole: "assistant", parts }).some(
        (part) => part.text.trim().length > 0
      )
    );
  });
  const assistantSettledAfterBaseline = messagesAfterBaseline.some(
    (message) =>
      message.role === "assistant" &&
      message.status !== "pending" &&
      message.status !== "streaming"
  );
  const isAwaitingReply =
    optimisticPrompt !== null &&
    !assistantContentAfterBaseline &&
    !assistantSettledAfterBaseline;
  const status =
    isSubmitting || isAwaitingReply
      ? "submitted"
      : hasStreamingMessage
        ? "streaming"
        : "ready";
  const isGenerating = status === "submitted" || status === "streaming";
  const isLoadingThread = Boolean(activeThreadId) && messagesStatus === "LoadingFirstPage";
  const isEmptyThread = !isLoadingThread && messages.length === 0 && status === "ready";
  const showOptimisticPrompt = optimisticPrompt !== null && !hasUserMessageAfterBaseline;
  const showTrailingThinking = isAwaitingReply;
  const showThreadSkeleton = isLoadingThread && optimisticPrompt === null;
  const firstName = user?.firstName?.trim() || null;
  const latestAssistantMessageId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const firstUserMessageId = messages.find((message) => message.role === "user")?.id;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);

  const startNewChat = useCallback(() => {
    setActiveThreadId(undefined);
    setOptimisticPrompt(null);
  }, []);

  useEffect(() => {
    textareaRef.current = document.querySelector("textarea");
  }, []);

  useEffect(() => {
    setActiveThreadId(threadId);
    // Navigating to a thread other than the one just submitted into means
    // the optimistic bubble no longer belongs on screen.
    setOptimisticPrompt((prev) =>
      prev && prev.threadId && prev.threadId !== threadId ? null : prev
    );
  }, [threadId]);

  useEffect(() => {
    // Retire the optimistic state only once the turn has settled: nothing in
    // flight and the assistant has either produced content or ended empty.
    // Clearing it any earlier reopens the flicker window while the
    // subscription's merged list is still reconciling.
    if (!optimisticPrompt) return;
    if (isSubmitting || hasStreamingMessage) return;
    if (assistantContentAfterBaseline || assistantSettledAfterBaseline) {
      setOptimisticPrompt(null);
    }
  }, [
    assistantContentAfterBaseline,
    assistantSettledAfterBaseline,
    hasStreamingMessage,
    isSubmitting,
    optimisticPrompt,
  ]);

  const setTextareaDraft = useCallback(({ text }: { text: string }) => {
    const textarea = textareaRef.current ?? document.querySelector("textarea");
    if (!textarea) return;

    textarea.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    nativeInputValueSetter?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);

  const scrollConversationToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      conversationBottomRef.current?.scrollIntoView({
        block: "end",
        behavior: "smooth",
      });
    });
  }, []);

  const applySavedQueryDraft = useCallback(
    ({ text }: { text: string }) => {
      setTextareaDraft({ text });
      scrollConversationToBottom();
    },
    [scrollConversationToBottom, setTextareaDraft]
  );

  useEffect(() => {
    if (
      messages.length === 0 &&
      status === "ready" &&
      !window.matchMedia("(pointer: coarse)").matches
    ) {
      textareaRef.current?.focus();
    }
  }, [messages.length, status]);

  useEffect(() => {
    if (!draftPrompt) return;
    setTextareaDraft({ text: draftPrompt.text });
  }, [draftPrompt, setTextareaDraft]);

  useEffect(() => {
    if (threadId || status !== "ready") return;
    const pendingDraft = window.sessionStorage.getItem(PENDING_SAVED_QUERY_DRAFT_KEY);
    if (!pendingDraft) return;
    const pendingRun = parseStagedSavedQuery({
      value: window.sessionStorage.getItem(PENDING_SAVED_QUERY_RUN_KEY),
    });
    window.sessionStorage.removeItem(PENDING_SAVED_QUERY_DRAFT_KEY);
    window.sessionStorage.removeItem(PENDING_SAVED_QUERY_RUN_KEY);
    setStagedSavedQuery(pendingRun);
    applySavedQueryDraft({ text: pendingDraft });
  }, [applySavedQueryDraft, status, threadId]);

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text?.trim();
      if (!text) return;

      setIsSubmitting(true);
      const baselineOrder = messages.reduce(
        (max, message) => Math.max(max, message.order ?? -1),
        -1
      );
      setOptimisticPrompt({ text, baselineOrder });
      try {
        const submitted = await submitMessageAction({
          model: selectedModelId,
          text,
          threadId: activeThreadId,
        });
        setOptimisticPrompt((prev) =>
          prev ? { ...prev, threadId: submitted.threadId } : prev
        );
        if (stagedSavedQuery && normalizeDisplayText({ text }) === normalizeDisplayText({ text: stagedSavedQuery.query })) {
          void markSavedQueryRunMutation({
            savedQueryId: stagedSavedQuery.savedQueryId,
            threadId: submitted.threadId,
          }).catch((error: unknown) => {
            console.error("[savedQueries] Could not mark saved query run", error);
          });
        }
        setStagedSavedQuery(null);
        if (!activeThreadId) {
          setActiveThreadId(submitted.threadId);
          // Update the URL without a router navigation: a real navigation
          // re-renders the route through its Suspense boundary, which can
          // remount this whole tree mid-stream, wiping the optimistic state
          // and flashing the page. The chat is state-driven, so only the
          // address bar needs to change; reloads and shares still resolve
          // through the /chat/[id] route.
          window.history.pushState(null, "", `/chat/${submitted.threadId}`);
        }
      } catch (error) {
        setOptimisticPrompt(null);
        toast.error(error instanceof Error ? error.message : "Could not send message");
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeThreadId, markSavedQueryRunMutation, messages, selectedModelId, stagedSavedQuery, submitMessageAction]
  );

  const stop = useCallback(() => {
    setOptimisticPrompt(null);
    if (!activeThreadId) return;
    void abortThreadMutation({ threadId: activeThreadId }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not stop response");
    });
  }, [abortThreadMutation, activeThreadId]);

  const handleModelChange = useCallback((value: string) => {
    if (isChatModelSelection(value)) {
      setSelectedModelId(value);
    }
  }, []);

  const handleSuggestionClick = useCallback(
    ({ prompt }: { prompt: string }) => {
      setTextareaDraft({ text: prompt });
    },
    [setTextareaDraft]
  );

  const stageSavedQuery = useCallback(
    ({ savedQuery }: { savedQuery: SavedQuery }) => {
      startNewChat();
      const stagedQuery = {
        savedQueryId: savedQuery._id,
        query: savedQuery.query,
      };
      if (threadId) {
        window.sessionStorage.setItem(PENDING_SAVED_QUERY_DRAFT_KEY, savedQuery.query);
        window.sessionStorage.setItem(PENDING_SAVED_QUERY_RUN_KEY, JSON.stringify(stagedQuery));
        router.push("/");
        return;
      }
      setStagedSavedQuery(stagedQuery);
      applySavedQueryDraft({ text: savedQuery.query });
    },
    [applySavedQueryDraft, router, startNewChat, threadId]
  );

  const copyMessageText = useCallback(async ({ text }: { text: string }) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Response copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy response");
    }
  }, []);

  const saveQuery = useCallback(
    async ({ query }: { query: string }) => {
      const trimmedQuery = query.replace(/\s+/g, " ").trim();
      if (!trimmedQuery) return;
      try {
        await saveQueryMutation({ query: trimmedQuery });
        toast.success("Query saved");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save query");
      }
    },
    [saveQueryMutation]
  );

  const renameSavedQuery = useCallback(
    async ({ savedQuery, title }: { savedQuery: SavedQuery; title: string }) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return;
      try {
        await renameSavedQueryMutation({
          savedQueryId: savedQuery._id,
          title: trimmedTitle,
        });
        toast.success("Saved query renamed");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not rename query");
        throw error;
      }
    },
    [renameSavedQueryMutation]
  );

  const removeSavedQuery = useCallback(
    async ({ savedQuery }: { savedQuery: SavedQuery }) => {
      try {
        await removeSavedQueryMutation({ savedQueryId: savedQuery._id });
        toast.success("Saved query deleted");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete query");
      }
    },
    [removeSavedQueryMutation]
  );

  const archiveThread = useCallback(
    async ({ thread }: { thread: RecentThread }) => {
      try {
        await archiveThreadMutation({ threadId: thread.threadId });
        if (thread.threadId === activeThreadId) {
          startNewChat();
          router.push("/");
        }
        toast.success("Chat deleted");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete chat");
      }
    },
    [activeThreadId, archiveThreadMutation, router, startNewChat]
  );

  const openMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(true);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(false);
  }, []);

  const handleNewChat = useCallback(() => {
    startNewChat();
    router.push("/");
  }, [router, startNewChat]);

  const contentColumnClass = compact
    ? "mx-auto w-full max-w-[768px]"
    : "w-full";

  return (
    <div className={`min-w-0 overflow-hidden ${compact ? "flex h-full w-full flex-col bg-zinc-50 lg:grid lg:grid-cols-[260px_minmax(0,1fr)]" : "flex h-[65vh] flex-col rounded-lg border border-zinc-200 bg-white md:h-[min(75vh,700px)] md:flex-1 lg:grid lg:grid-cols-[260px_minmax(0,1fr)]"}`}>
      <SavedQueriesSidebar
        activeThreadId={activeThreadId}
        recentThreads={recentThreads}
        savedQueries={savedQueries}
        stats={stats}
        onArchiveThread={archiveThread}
        onNewChat={handleNewChat}
        onRemove={removeSavedQuery}
        onRename={renameSavedQuery}
        onStage={stageSavedQuery}
      />
      <MobileSidebarDrawer
        activeThreadId={activeThreadId}
        isOpen={isMobileSidebarOpen}
        recentThreads={recentThreads}
        savedQueries={savedQueries}
        stats={stats}
        onArchiveThread={archiveThread}
        onClose={closeMobileSidebar}
        onNewChat={handleNewChat}
        onRemove={removeSavedQuery}
        onRename={renameSavedQuery}
        onStage={stageSavedQuery}
      />
      <div className={`flex min-h-0 min-w-0 flex-1 flex-col lg:col-start-2 lg:h-full ${isEmptyThread ? "px-4 pb-5 pt-6 md:px-6 lg:justify-center lg:py-6" : ""}`}>
        {compact && (
          <div className={`flex shrink-0 items-center justify-between gap-3 lg:hidden ${isEmptyThread ? "mb-5" : "border-b border-zinc-200/80 bg-zinc-50/90 px-4 py-3 backdrop-blur"}`}>
            <button
              type="button"
              onClick={openMobileSidebar}
              className="flex size-10 cursor-pointer items-center justify-center rounded-lg bg-zinc-200/50 text-zinc-600 transition-[background-color,color,transform] hover:bg-zinc-200/80 hover:text-zinc-950 active:scale-[0.96]"
              aria-label="Open chat history"
            >
              <MenuIcon className="size-4" />
            </button>
            {!isEmptyThread && (
              <button
                type="button"
                onClick={handleNewChat}
                className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-200/50 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-[background-color,color,transform] hover:bg-zinc-200/80 hover:text-zinc-900 active:scale-[0.96]"
              >
                <PlusIcon className="size-3.5" />
                New chat
              </button>
            )}
          </div>
        )}
        <Conversation className={isEmptyThread ? "flex-none overflow-visible" : undefined}>
          <ConversationContent
            scrollClassName={isEmptyThread ? undefined : "absolute inset-0 overflow-auto"}
            className={`${isEmptyThread ? "min-h-0 gap-0 px-0 py-0" : "min-h-full px-4 py-8 md:py-10"} w-full *:w-full ${compact ? "[&>*]:mx-auto [&>*]:max-w-[768px]" : ""}`}
          >
            <div
              aria-hidden="true"
              className="h-0 w-full shrink-0 overflow-hidden"
            />
            {isEmptyThread && (
              <ChatWelcome firstName={firstName} isUserLoaded={isUserLoaded} stats={stats} />
            )}
            {messages.map((message) => {
              const parts = message.parts as ChatMessagePart[];
              const thinkingParts = getPreOutputThinkingParts({ parts });
              const textParts = getVisibleTextParts({
                messageRole: message.role,
                parts,
              });
              const messageText = textParts.map((part) => part.text).join("\n\n").trim();
              // A contentless assistant record (still pending, or settled
              // empty after an abort) renders nothing; the trailing Thinking
              // placeholder owns that window. Rendering an empty message here
              // would add a phantom gap and flicker as the stream reconciles.
              if (message.role === "assistant" && thinkingParts.length === 0 && !messageText) {
                return null;
              }
              const isThinkingActive =
                message.id === latestAssistantMessageId &&
                message.role === "assistant" &&
                status === "streaming";
              const isMessageStreaming =
                message.role === "assistant" && message.status === "streaming";
              const resolvedModelLabel =
                message.role === "assistant" ? resolvedModelForMessage({ message, parts }) : null;
              return (
                <Message
                  className={message.role === "assistant" ? "max-w-full" : undefined}
                  from={message.role as "user" | "assistant"}
                  key={message.id}
                >
                  <div className="w-full min-w-full">
                    {message.role === "assistant" && thinkingParts.length > 0 && (
                      <ThinkingSteps
                        parts={parts}
                        isStreaming={isThinkingActive}
                      />
                    )}
                    {textParts.map((part) => {
                      const originalIndex = parts.indexOf(part);
                      return (
                        <MessageContent
                          key={originalIndex}
                          className={message.role === "assistant" ? "w-full" : undefined}
                        >
                          {message.role === "assistant" ? (
                            <AssistantAnswerText
                              text={part.text}
                              isStreaming={isMessageStreaming}
                            />
                          ) : (
                            <MessageResponse>{part.text}</MessageResponse>
                          )}
                        </MessageContent>
                      );
                    })}
                    {message.role === "user" && message.id === firstUserMessageId && messageText && (
                      <div className="mt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => saveQuery({ query: messageText })}
                          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-zinc-400 transition-[background-color,color,transform] duration-150 hover:bg-zinc-200/60 hover:text-zinc-900 active:scale-[0.96]"
                        >
                          <BookmarkIcon className="size-3.5" />
                          Save
                        </button>
                      </div>
                    )}
                    {message.role === "assistant" && messageText && !isMessageStreaming && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => { void copyMessageText({ text: messageText }); }}
                          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-zinc-400 opacity-100 transition-[background-color,color,opacity] duration-150 hover:bg-zinc-200/60 hover:text-zinc-900 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                          aria-label="Copy response"
                          title="Copy response"
                        >
                          <CopyIcon className="size-3.5" />
                        </button>
                        {resolvedModelLabel && (
                          <p className="text-xs leading-5 text-zinc-400 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100">
                            Answered by {resolvedModelLabel}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </Message>
              );
            })}
            {showOptimisticPrompt && optimisticPrompt && (
              <Message from="user" className="animate-message-in">
                <div className="w-full min-w-full">
                  <MessageContent>
                    <MessageResponse>{optimisticPrompt.text}</MessageResponse>
                  </MessageContent>
                </div>
              </Message>
            )}
            {showThreadSkeleton && (
              <div className="w-full space-y-6 py-2" aria-hidden="true">
                <div className="ml-auto h-10 w-2/5 animate-pulse rounded-[1.35rem] bg-zinc-200/60" />
                <div className="space-y-2.5">
                  <div className="h-4 w-11/12 animate-pulse rounded-md bg-zinc-200/60" />
                  <div className="h-4 w-full animate-pulse rounded-md bg-zinc-200/60" />
                  <div className="h-4 w-3/5 animate-pulse rounded-md bg-zinc-200/60" />
                </div>
              </div>
            )}
            {showTrailingThinking && (
              <Message from="assistant" className="max-w-full animate-message-in">
                <span className="text-shimmer inline-block w-fit py-1 text-sm font-medium leading-5">
                  Thinking
                </span>
              </Message>
            )}
            <div ref={conversationBottomRef} aria-hidden="true" className="h-0 w-full shrink-0" />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className={`z-10 grid min-w-0 shrink-0 bg-zinc-50/95 backdrop-blur lg:static lg:bg-transparent lg:backdrop-blur-none ${isEmptyThread ? "sticky bottom-0 mt-auto gap-3 pt-6 sm:pt-6 lg:mt-0 lg:gap-5 lg:pt-8" : "sticky bottom-0 gap-3 pt-3"}`}>
          {isEmptyThread && (
            <ChatSuggestions
              className={`${contentColumnClass} order-1 lg:order-2`}
              onPromptSelect={handleSuggestionClick}
            />
          )}
          <div className={`${contentColumnClass} min-w-0 ${isEmptyThread ? "order-2 px-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:order-1 lg:pb-0" : "px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3"}`}>
            <PromptInput
              onSubmit={handleSubmit}
              className="group/prompt min-w-0 **:data-[slot=input-group]:min-w-0 **:data-[slot=input-group]:rounded-[1.35rem] **:data-[slot=input-group]:border-zinc-200 **:data-[slot=input-group]:bg-white **:data-[slot=input-group]:border **:data-[slot=input-group]:shadow-[0_1px_2px_rgba(24,24,27,0.03),0_8px_24px_-16px_rgba(24,24,27,0.14)] border-zinc-200"
            >
              <PromptInputBody>
                <PromptInputTextarea
                  className={
                    isEmptyThread
                      ? "min-h-24 min-w-0 px-4 py-4 text-base leading-6 placeholder:text-zinc-400 lg:min-h-28 lg:px-5 lg:py-5 lg:text-base"
                      : "min-h-10 min-w-0 px-4 py-3 text-base leading-6 placeholder:text-zinc-400"
                  }
                  placeholder="Ask about customer feedback..."
                />
              </PromptInputBody>
              <PromptInputFooter className={`gap-2 justify-between ${isEmptyThread ? "px-3 pb-3 lg:px-4 lg:pb-4" : ""}`}>
                <Select
                  value={selectedModelId}
                  onValueChange={handleModelChange}
                  disabled={status !== "ready"}
                >
                  <SelectTrigger
                    aria-label="Chat model"
                    className={`${isEmptyThread ? "h-9" : "h-8"} w-auto max-w-[160px] shrink-0 gap-1 rounded-lg border-0 bg-transparent px-2.5 text-xs font-medium text-zinc-500 shadow-none outline-none transition-[background-color,color] duration-150 hover:bg-zinc-100 hover:text-zinc-900 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:outline-none data-[state=open]:bg-zinc-100 data-[state=open]:text-zinc-900 [&>span]:block [&>span]:truncate [&>svg]:size-3.5`}
                  >
                    <SelectValue>
                      {selectedModel ? selectedModel.label : "Model"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    className="w-[180px] rounded-xl border-zinc-200 bg-white p-1.5 shadow-overlay"
                  >
                    {CHAT_MODEL_OPTIONS.map((model) => (
                      <SelectItem
                        key={model.id}
                        value={model.id}
                        className="cursor-pointer rounded-lg py-2 pl-2.5 pr-8 text-xs text-zinc-700 focus:bg-zinc-100 focus:text-zinc-950 data-[state=checked]:text-zinc-950 data-[state=checked]:font-medium [&_svg]:text-zinc-600"
                      >
                        <span className="block truncate">{model.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  {!compact && messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        startNewChat();
                        router.push("/");
                      }}
                      className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-[background-color,color,transform] hover:bg-zinc-200/70 hover:text-zinc-900 active:scale-[0.96]"
                    >
                      <PlusIcon className="size-3.5" />
                      New chat
                    </button>
                  )}
                  <PromptInputSubmit
                    onStop={stop}
                    status={status}
                    title={isGenerating ? "Stop response" : "Send message"}
                    className={`shrink-0 cursor-pointer rounded-full p-0 transition-[background-color,border-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 active:scale-[0.95] ${
                      isEmptyThread ? "size-9" : "size-8"
                    } ${
                      isGenerating
                        ? "border border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800"
                        : "border border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800 group-has-[textarea:placeholder-shown]/prompt:border-zinc-300 group-has-[textarea:placeholder-shown]/prompt:bg-white group-has-[textarea:placeholder-shown]/prompt:text-zinc-500 group-has-[textarea:placeholder-shown]/prompt:hover:border-zinc-400 group-has-[textarea:placeholder-shown]/prompt:hover:bg-zinc-50 group-has-[textarea:placeholder-shown]/prompt:hover:text-zinc-800"
                    }`}
                  >
                    {status === "submitted" ? (
                      <Spinner className="size-4" />
                    ) : isGenerating ? (
                      <SquareIcon className="size-3 fill-current" />
                    ) : (
                      <ArrowUpIcon className="size-4" />
                    )}
                  </PromptInputSubmit>
                </div>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileSidebarDrawer({
  activeThreadId,
  isOpen,
  recentThreads,
  savedQueries,
  stats,
  onArchiveThread,
  onClose,
  onNewChat,
  onRemove,
  onRename,
  onStage,
}: {
  activeThreadId?: string;
  isOpen: boolean;
  recentThreads: RecentThread[] | undefined;
  savedQueries: SavedQuery[] | undefined;
  stats?: ChatWelcomeStats | null;
  onArchiveThread: ({ thread }: { thread: RecentThread }) => Promise<void>;
  onClose: () => void;
  onNewChat: () => void;
  onRemove: ({ savedQuery }: { savedQuery: SavedQuery }) => void;
  onRename: ({ savedQuery, title }: { savedQuery: SavedQuery; title: string }) => Promise<void>;
  onStage: ({ savedQuery }: { savedQuery: SavedQuery }) => void;
}) {
  const handleNewChat = useCallback(() => {
    onNewChat();
    onClose();
  }, [onClose, onNewChat]);

  const handleStage = useCallback(
    ({ savedQuery }: { savedQuery: SavedQuery }) => {
      onStage({ savedQuery });
      onClose();
    },
    [onClose, onStage]
  );

  return (
    <Sheet open={isOpen} onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <SheetContent
        side="left"
        className="flex w-[min(86vw,340px)] flex-col gap-0 bg-zinc-50 p-0 [&>button]:hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Chat history</SheetTitle>
        </SheetHeader>
        <SavedQueriesSidebar
          activeThreadId={activeThreadId}
          isMobile
          recentThreads={recentThreads}
          savedQueries={savedQueries}
          stats={stats}
          onArchiveThread={onArchiveThread}
          onClose={onClose}
          onNewChat={handleNewChat}
          onThreadSelect={onClose}
          onRemove={onRemove}
          onRename={onRename}
          onStage={handleStage}
        />
      </SheetContent>
    </Sheet>
  );
}

function SavedQueriesSidebar({
  activeThreadId,
  isMobile = false,
  recentThreads,
  savedQueries,
  stats,
  onArchiveThread,
  onClose,
  onNewChat,
  onThreadSelect,
  onRemove,
  onRename,
  onStage,
}: {
  activeThreadId?: string;
  isMobile?: boolean;
  recentThreads: RecentThread[] | undefined;
  savedQueries: SavedQuery[] | undefined;
  stats?: ChatWelcomeStats | null;
  onArchiveThread: ({ thread }: { thread: RecentThread }) => Promise<void>;
  onClose?: () => void;
  onNewChat: () => void;
  onThreadSelect?: () => void;
  onRemove: ({ savedQuery }: { savedQuery: SavedQuery }) => void;
  onRename: ({ savedQuery, title }: { savedQuery: SavedQuery; title: string }) => Promise<void>;
  onStage: ({ savedQuery }: { savedQuery: SavedQuery }) => void;
}) {
  const [renamingSavedQuery, setRenamingSavedQuery] = useState<SavedQuery | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamingSavedQueryId, setRenamingSavedQueryId] = useState<string | null>(null);
  const [showAllThreads, setShowAllThreads] = useState(false);
  const displayedThreads = useMemo(() => {
    if (!recentThreads) return undefined;
    return showAllThreads ? recentThreads : recentThreads.slice(0, 8);
  }, [recentThreads, showAllThreads]);
  const hasMoreThreads = (recentThreads?.length ?? 0) > 8;
  const beginRename = useCallback(({ savedQuery }: { savedQuery: SavedQuery }) => {
    setRenamingSavedQuery(savedQuery);
    setRenameDraft(savedQuery.title);
  }, []);
  const cancelRename = useCallback(() => {
    setRenamingSavedQuery(null);
    setRenameDraft("");
  }, []);
  const submitRename = useCallback(
    async ({ savedQuery }: { savedQuery: SavedQuery | null }) => {
      if (!savedQuery) return;
      const title = renameDraft.trim();
      if (!title) return;
      setRenamingSavedQueryId(savedQuery._id);
      try {
        await onRename({ savedQuery, title });
        cancelRename();
      } finally {
        setRenamingSavedQueryId(null);
      }
    },
    [cancelRename, onRename, renameDraft]
  );
  const copySavedQuery = useCallback(async ({ savedQuery }: { savedQuery: SavedQuery }) => {
    try {
      await navigator.clipboard.writeText(savedQuery.query);
      toast.success("Saved query copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy query");
    }
  }, []);

  return (
    <>
      <aside
        className={
          isMobile
            ? "flex min-h-0 flex-1 shrink-0 flex-col bg-zinc-50"
            : "hidden min-h-0 flex-col border-r border-zinc-200/80 bg-zinc-50 lg:col-start-1 lg:flex lg:h-full"
        }
      >
        <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2 pt-3">
          {isMobile && (
            <button
              type="button"
              onClick={onClose}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-950 active:scale-[0.96]"
              aria-label="Close chat history"
            >
              <PanelLeftCloseIcon className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onNewChat}
            className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-800 shadow-[0_1px_2px_rgba(24,24,27,0.04)] transition-[background-color,border-color,color,transform] duration-150 hover:border-zinc-300 hover:text-zinc-950 active:scale-[0.98]"
          >
            <PlusIcon className="size-4 text-zinc-500" />
            New chat
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4 pt-2">
          <SidebarSection title="Recents">
            {recentThreads === undefined ? (
              <SidebarSkeleton />
            ) : recentThreads.length === 0 ? (
              <SidebarEmpty label="No chats yet" />
            ) : (
              <div className="space-y-px">
                {displayedThreads?.map((thread) => {
                  const isActive = thread.threadId === activeThreadId;
                  return (
                    <div key={thread.threadId} className="group relative">
                      <Link
                        href={`/chat/${thread.threadId}`}
                        onClick={onThreadSelect}
                        className={`flex h-9 items-center rounded-lg pl-2.5 pr-8 transition-[background-color,color] duration-150 ${
                          isActive
                            ? "bg-zinc-200/60 text-zinc-950"
                            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                        }`}
                      >
                        <span className={`min-w-0 truncate text-sm leading-5 ${isActive ? "font-medium" : ""}`}>
                          {thread.title}
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => { void onArchiveThread({ thread }); }}
                        className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-zinc-400 opacity-100 transition-[background-color,color,opacity] duration-150 hover:bg-zinc-200/70 hover:text-red-600 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        aria-label={`Delete chat: ${thread.title}`}
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
                {hasMoreThreads && (
                  <button
                    type="button"
                    onClick={() => setShowAllThreads((prev) => !prev)}
                    className="flex h-8 w-full cursor-pointer items-center rounded-lg px-2.5 text-left text-xs font-medium text-zinc-400 transition-[background-color,color] duration-150 hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    {showAllThreads ? "Show less" : "Show all"}
                  </button>
                )}
              </div>
            )}
          </SidebarSection>

          <SidebarSection title="Saved">
            {savedQueries === undefined ? (
              <SidebarSkeleton />
            ) : savedQueries.length === 0 ? (
              <SidebarEmpty label="No saved queries yet" />
            ) : (
              <div className="space-y-px">
                {savedQueries.map((savedQuery) => (
                  <div key={savedQuery._id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onStage({ savedQuery })}
                      className="flex h-9 w-full cursor-pointer items-center rounded-lg pl-2.5 pr-8 text-left text-zinc-600 transition-[background-color,color] duration-150 hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      <span className="min-w-0 truncate text-sm leading-5">
                        {savedQuery.title}
                      </span>
                    </button>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-zinc-400 opacity-100 transition-[background-color,color,opacity] duration-150 hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:opacity-100 data-[state=open]:bg-zinc-200/70 data-[state=open]:opacity-100 data-[state=open]:text-zinc-900 md:opacity-0 md:group-hover:opacity-100"
                          aria-label={`Saved query actions: ${savedQuery.title}`}
                        >
                          <MoreHorizontalIcon className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-36 rounded-xl border-zinc-200 bg-white p-1.5 shadow-overlay"
                      >
                        <DropdownMenuItem
                          onClick={() => beginRename({ savedQuery })}
                          className="cursor-pointer rounded-lg text-xs"
                        >
                          <PencilIcon className="size-3.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            void copySavedQuery({ savedQuery });
                          }}
                          className="cursor-pointer rounded-lg text-xs"
                        >
                          <CopyIcon className="size-3.5" />
                          Copy
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onRemove({ savedQuery })}
                          className="cursor-pointer rounded-lg text-xs text-red-600 focus:bg-red-50 focus:text-red-700"
                        >
                          <Trash2Icon className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </SidebarSection>
        </div>
        <SidebarMetadataFooter stats={stats} />
      </aside>
      <Dialog
        open={renamingSavedQuery !== null}
        onOpenChange={(open) => {
          if (!open) cancelRename();
        }}
      >
        <DialogContent className="max-w-md rounded-xl border-zinc-200 bg-white p-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename({ savedQuery: renamingSavedQuery });
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-base text-zinc-950">
                Rename saved query
              </DialogTitle>
            </DialogHeader>
            <div className="mt-4">
              <Textarea
                autoFocus
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                className="min-h-28 resize-y rounded-lg border-zinc-200 px-3 py-2 text-sm leading-5 shadow-none focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-0"
                aria-label="Saved query title"
              />
            </div>
            <DialogFooter className="mt-5 gap-2 sm:space-x-0">
              <button
                type="button"
                onClick={cancelRename}
                className="min-h-10 cursor-pointer rounded-lg px-3 text-sm font-medium text-zinc-500 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.96]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={renamingSavedQueryId !== null || !renameDraft.trim()}
                className="min-h-10 cursor-pointer rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white transition-[background-color,transform] hover:bg-zinc-800 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:active:scale-100"
              >
                Save
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SidebarSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <div className="px-2.5 pb-1.5 text-xs font-medium text-zinc-400">
        {title}
      </div>
      <div className="min-h-0">{children}</div>
    </section>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-1 py-0.5">
      <div className="h-9 animate-pulse rounded-lg bg-zinc-200/50" />
      <div className="h-9 animate-pulse rounded-lg bg-zinc-200/30" />
    </div>
  );
}

function SidebarEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5 text-xs leading-5 text-zinc-400">
      {label}
    </div>
  );
}

function normalizeDisplayText({ text }: { text: string }): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function parseStagedSavedQuery({
  value,
}: {
  value: string | null;
}): StagedSavedQuery | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as { savedQueryId?: unknown; query?: unknown };
    if (typeof candidate.savedQueryId !== "string" || typeof candidate.query !== "string") {
      return null;
    }
    return {
      savedQueryId: candidate.savedQueryId as Id<"savedQueries">,
      query: candidate.query,
    };
  } catch {
    return null;
  }
}
