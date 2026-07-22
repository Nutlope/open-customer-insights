"use client";

import { useUIMessages } from "@convex-dev/agent/react";
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
    { count: stats?.dailyInsightsCount, href: "/daily", label: "daily insights", source: "daily" },
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
          const className = "group relative inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full bg-white/70 px-2 py-1 text-[11px] font-medium leading-4 text-zinc-500 shadow-[0_0_0_1px_rgba(24,24,27,0.07)] transition-[background-color,color,box-shadow] hover:bg-white hover:text-zinc-800 hover:shadow-[0_1px_4px_rgba(24,24,27,0.08),0_0_0_1px_rgba(24,24,27,0.10)] focus-visible:bg-white focus-visible:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300";
          const content = (
            <>
              <SourceIcon source={item.source} />
              <span>{label}</span>
              {item.detail && (
                <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 whitespace-nowrap rounded-md bg-zinc-950 px-2 py-1 text-[10px] font-medium leading-4 text-white opacity-0 shadow-[0_10px_24px_rgba(24,24,27,0.18)] transition-[opacity,transform] duration-150 ease-out group-hover:-translate-y-0.5 group-hover:opacity-100 group-focus-visible:-translate-y-0.5 group-focus-visible:opacity-100">
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
  const status = isSubmitting ? "submitted" : hasStreamingMessage ? "streaming" : "ready";
  const isGenerating = status === "submitted" || status === "streaming";
  const isLoadingThread = Boolean(activeThreadId) && messagesStatus === "LoadingFirstPage";
  const isEmptyThread = !isLoadingThread && messages.length === 0 && status === "ready";
  const firstName = user?.firstName?.trim() || null;
  const latestAssistantMessageId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const firstUserMessageId = messages.find((message) => message.role === "user")?.id;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);

  const startNewChat = useCallback(() => {
    setActiveThreadId(undefined);
  }, []);

  useEffect(() => {
    textareaRef.current = document.querySelector("textarea");
  }, []);

  useEffect(() => {
    setActiveThreadId(threadId);
  }, [threadId]);

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
      try {
        const submitted = await submitMessageAction({
          model: selectedModelId,
          text,
          threadId: activeThreadId,
        });
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
          router.push(`/chat/${submitted.threadId}`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not send message");
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeThreadId, markSavedQueryRunMutation, router, selectedModelId, stagedSavedQuery, submitMessageAction]
  );

  const stop = useCallback(() => {
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
    ? "mx-auto w-full max-w-[700px]"
    : "w-full";

  return (
    <div className={`min-w-0 overflow-hidden ${compact ? "flex h-full w-full flex-col bg-white lg:grid lg:grid-cols-[260px_minmax(0,1fr)]" : "flex h-[65vh] flex-col rounded-lg border border-zinc-200 bg-white md:h-[min(75vh,700px)] md:flex-1 lg:grid lg:grid-cols-[260px_minmax(0,1fr)]"}`}>
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
          <div className={`flex shrink-0 items-center justify-between gap-3 lg:hidden ${isEmptyThread ? "mb-5" : "border-b border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur"}`}>
            <button
              type="button"
              onClick={openMobileSidebar}
              className="flex size-10 cursor-pointer items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition-[background-color,color,transform] hover:bg-zinc-200/70 hover:text-zinc-950 active:scale-[0.96]"
              aria-label="Open chat history"
            >
              <MenuIcon className="size-4" />
            </button>
            {!isEmptyThread && (
              <button
                type="button"
                onClick={handleNewChat}
                className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-[background-color,color,transform] hover:bg-zinc-200/70 hover:text-zinc-900 active:scale-[0.96]"
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
            className={`${isEmptyThread ? "min-h-0 gap-0 px-0 py-0" : "min-h-full px-4 py-8 md:py-10"} w-full *:w-full ${compact ? "[&>*]:mx-auto [&>*]:max-w-[820px]" : ""}`}
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
              const isThinkingActive =
                message.id === latestAssistantMessageId &&
                message.role === "assistant" &&
                status === "streaming";
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
                          <MessageResponse>{part.text}</MessageResponse>
                        </MessageContent>
                      );
                    })}
                    {message.role === "user" && message.id === firstUserMessageId && messageText && (
                      <div className="mt-1.5 flex justify-end">
                        <button
                          type="button"
                          onClick={() => saveQuery({ query: messageText })}
                          className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.96]"
                        >
                          <BookmarkIcon className="size-3.5" />
                          Save
                        </button>
                      </div>
                    )}
                    {resolvedModelLabel && textParts.length > 0 && (
                      <p className="mt-1.5 text-xs text-zinc-400">
                        Answered by {resolvedModelLabel}
                      </p>
                    )}
                  </div>
                </Message>
              );
            })}
            {(isLoadingThread || status === "submitted") && (
              <Message from="assistant" className="max-w-full">
                <div className="flex items-center gap-1.5 py-2">
                  <span className="size-2 rounded-full bg-zinc-300 animate-bounce [animation-delay:-0.32s]" />
                  <span className="size-2 rounded-full bg-zinc-300 animate-bounce [animation-delay:-0.16s]" />
                  <span className="size-2 rounded-full bg-zinc-300 animate-bounce" />
                </div>
              </Message>
            )}
            <div ref={conversationBottomRef} aria-hidden="true" className="h-0 w-full shrink-0" />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className={`z-10 grid min-w-0 shrink-0 bg-white/95 backdrop-blur lg:static lg:bg-transparent lg:backdrop-blur-none ${isEmptyThread ? "sticky bottom-0 mt-auto gap-3 pt-6 sm:pt-6 lg:mt-0 lg:gap-5 lg:pt-8" : "sticky bottom-0 gap-3 pt-3"}`}>
          {isEmptyThread && (
            <ChatSuggestions
              className={`${contentColumnClass} order-1 lg:order-2`}
              onPromptSelect={handleSuggestionClick}
            />
          )}
          <div className={`${contentColumnClass} min-w-0 ${isEmptyThread ? "order-2 px-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:order-1 lg:pb-0" : "px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3"}`}>
            <PromptInput
              onSubmit={handleSubmit}
              className={
                isEmptyThread
                  ? "min-w-0 **:data-[slot=input-group]:min-w-0 **:data-[slot=input-group]:rounded-[1.35rem] **:data-[slot=input-group]:border-zinc-200 **:data-[slot=input-group]:bg-white **:data-[slot=input-group]:shadow-[0_22px_70px_rgba(24,24,27,0.13),0_6px_18px_rgba(24,24,27,0.08),0_0_0_1px_rgba(24,24,27,0.04)]"
                  : "min-w-0 **:data-[slot=input-group]:min-w-0 **:data-[slot=input-group]:rounded-2xl **:data-[slot=input-group]:border-zinc-200 **:data-[slot=input-group]:bg-white **:data-[slot=input-group]:shadow-[0_0_0_1px_rgba(24,24,27,0.02),0_1px_2px_rgba(24,24,27,0.04)]"
              }
            >
              <PromptInputBody>
                <PromptInputTextarea
                  className={isEmptyThread ? "min-h-24 min-w-0 px-4 py-4 text-[15px] leading-6 placeholder:text-zinc-400 lg:min-h-28 lg:px-5 lg:py-5 lg:text-base" : "min-w-0"}
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
                    className={`${isEmptyThread ? "h-8 w-[142px]" : "h-7 w-[132px]"} shrink-0 rounded-lg border-0 bg-zinc-100 px-2.5 text-xs font-medium text-zinc-500 shadow-none transition-[background-color,color,transform] hover:bg-zinc-200/70 hover:text-zinc-900 focus:ring-1 focus:ring-zinc-300 focus:ring-offset-0 data-[state=open]:bg-zinc-200/70 data-[state=open]:text-zinc-900 [&>span]:block [&>span]:truncate [&>svg]:size-3.5`}
                  >
                    <SelectValue>
                      {selectedModel ? selectedModel.label : "Model"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    className="w-[180px] rounded-xl border-zinc-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(24,24,27,0.14)]"
                  >
                    {CHAT_MODEL_OPTIONS.map((model) => (
                      <SelectItem
                        key={model.id}
                        value={model.id}
                        className="rounded-lg py-2 pl-8 pr-2 text-xs text-zinc-700 focus:bg-zinc-100 focus:text-zinc-950 data-[state=checked]:bg-zinc-100 data-[state=checked]:text-zinc-950 [&_svg]:text-zinc-600"
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
                    className={`shrink-0 rounded-lg transition-[background-color,border-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-zinc-300 focus-visible:ring-offset-2 active:scale-[0.96] ${
                      isGenerating
                        ? "size-8 cursor-pointer border border-zinc-900 bg-zinc-900 p-0 text-white shadow-sm hover:bg-zinc-800 [&>svg]:size-3.5"
                        : `${isEmptyThread ? "size-10 bg-zinc-950 text-white shadow-[0_8px_18px_rgba(24,24,27,0.18)] hover:bg-zinc-800 hover:shadow-[0_10px_24px_rgba(24,24,27,0.22)] [&>svg]:size-[18px]" : "size-8 border border-zinc-300 bg-white text-zinc-950 shadow-[0_1px_2px_rgba(24,24,27,0.08),0_1px_0_rgba(255,255,255,0.9)_inset] hover:border-zinc-400 hover:bg-zinc-50 hover:shadow-[0_2px_6px_rgba(24,24,27,0.12)] [&>svg]:size-4"} cursor-pointer p-0`
                    }`}
                  >
                    {isGenerating ? <SquareIcon className="size-3.5 fill-current" /> : <ArrowUpIcon className="size-4" />}
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
    return showAllThreads ? recentThreads : recentThreads.slice(0, 5);
  }, [recentThreads, showAllThreads]);
  const recentThreadGroups = useMemo(
    () => (displayedThreads ? groupRecentThreads({ threads: displayedThreads }) : []),
    [displayedThreads]
  );
  const hasMoreThreads = (recentThreads?.length ?? 0) > 5;
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
            : "hidden min-h-0 flex-col border-r border-zinc-200 bg-zinc-50 lg:col-start-1 lg:flex lg:h-full"
        }
      >
        <div className="flex shrink-0 items-center gap-2 px-4 py-4">
          {isMobile && (
            <button
              type="button"
              onClick={onClose}
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-950 active:scale-[0.96]"
              aria-label="Close chat history"
            >
              <PanelLeftCloseIcon className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onNewChat}
            className="flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-zinc-700 shadow-[0_0_0_1px_rgba(24,24,27,0.08),0_1px_2px_rgba(24,24,27,0.04)] transition-[background-color,color,box-shadow,transform] hover:bg-zinc-50 hover:text-zinc-950 hover:shadow-[0_0_0_1px_rgba(24,24,27,0.11),0_2px_8px_rgba(24,24,27,0.06)] active:scale-[0.96]"
          >
            <PlusIcon className="size-4" />
            New chat
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-5">
          <SidebarSection
            count={recentThreads?.length}
            title="Recent chats"
          >
            {recentThreads === undefined ? (
              <SidebarSkeleton />
            ) : recentThreads.length === 0 ? (
              <SidebarEmpty label="No recent chats yet." />
            ) : (
              <div className="space-y-3">
                {recentThreadGroups.map((group) => (
                  <div key={group.key} className="space-y-1">
                    <div className="px-2 text-[11px] font-medium leading-5 text-zinc-400">
                      {group.label}
                    </div>
                    {group.threads.map((thread) => (
                      <div
                        key={thread.threadId}
                        className={`group flex items-center gap-1 rounded-lg transition-[background-color,box-shadow] ${
                          thread.threadId === activeThreadId
                            ? "bg-white shadow-[0_0_0_1px_rgba(24,24,27,0.08),0_1px_4px_rgba(24,24,27,0.06)]"
                            : "hover:bg-zinc-100/70"
                        }`}
                      >
                        <Link
                          href={`/chat/${thread.threadId}`}
                          onClick={onThreadSelect}
                          className="block min-h-10 min-w-0 flex-1 px-2.5 py-2 active:scale-[0.99] transition-transform"
                        >
                          <span className={`line-clamp-2 max-w-full text-[13px] font-medium leading-5 ${thread.threadId === activeThreadId ? "text-zinc-950" : "text-zinc-700"}`}>
                            {thread.title}
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => { void onArchiveThread({ thread }); }}
                          className="mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-400 opacity-100 transition-[background-color,color,transform] hover:bg-white hover:text-red-600 active:scale-[0.96] md:opacity-0 md:group-hover:opacity-100"
                          aria-label="Delete chat"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
                {hasMoreThreads && (
                  <button
                    type="button"
                    onClick={() => setShowAllThreads((prev) => !prev)}
                    className="mt-1 w-full cursor-pointer rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-zinc-400 transition-[background-color,color] hover:bg-zinc-100/70 hover:text-zinc-600"
                  >
                    {showAllThreads ? "Show less" : "Show older chats"}
                  </button>
                )}
              </div>
            )}
          </SidebarSection>

          <SidebarSection
            count={savedQueries?.length}
            title="Saved queries"
          >
            {savedQueries === undefined ? (
              <SidebarSkeleton />
            ) : savedQueries.length === 0 ? (
              <SidebarEmpty label="No saved queries yet." />
            ) : (
              <div className="space-y-1">
                {savedQueries.map((savedQuery) => {
                  const showSubtitle = !sameDisplayText({
                    first: savedQuery.title,
                    second: savedQuery.query,
                  });

                  return (
                    <div
                      key={savedQuery._id}
                      className="group flex items-center gap-1 rounded-lg transition-[background-color] hover:bg-zinc-100/70"
                    >
                      <button
                        type="button"
                        onClick={() => onStage({ savedQuery })}
                        className="block min-h-10 min-w-0 flex-1 cursor-pointer rounded-lg px-2.5 py-2 text-left transition-[color,transform] active:scale-[0.99]"
                      >
                        <span className="block min-w-0">
                          <span className="line-clamp-2 max-w-full text-[13px] font-medium leading-5 text-zinc-800">
                            {savedQuery.title}
                          </span>
                          {showSubtitle && (
                            <span className="mt-0.5 line-clamp-2 max-w-full text-[11px] leading-4 text-zinc-400/90">
                              {savedQuery.query}
                            </span>
                          )}
                        </span>
                      </button>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-400 opacity-100 transition-[background-color,color,transform] hover:bg-white hover:text-zinc-900 active:scale-[0.96] md:opacity-0 md:group-hover:opacity-100"
                            aria-label="Saved query actions"
                          >
                            <MoreHorizontalIcon className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-36 rounded-xl border-zinc-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(24,24,27,0.14)]"
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
                  );
                })}
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
        <DialogContent className="max-w-md rounded-xl border-zinc-200 bg-white p-5 shadow-[0_24px_80px_rgba(24,24,27,0.22)]">
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
  count,
  title,
}: {
  children: ReactNode;
  count?: number;
  title: string;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="text-[11px] font-semibold uppercase text-zinc-500">
          {title}
        </div>
        {count !== undefined && count > 0 && (
          <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
            {count}
          </span>
        )}
      </div>
      <div className="mt-2 min-h-0 pr-1">{children}</div>
    </section>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-2 py-1">
      <div className="h-10 rounded-lg bg-zinc-200/60" />
      <div className="h-10 rounded-lg bg-zinc-200/40" />
    </div>
  );
}

function SidebarEmpty({ label }: { label: string }) {
  return (
    <div className="rounded-lg px-2 py-2 text-xs leading-5 text-zinc-400">
      {label}
    </div>
  );
}

type RecentThreadGroup = {
  key: string;
  label: string;
  threads: RecentThread[];
};

function groupRecentThreads({ threads }: { threads: RecentThread[] }): RecentThreadGroup[] {
  const selectedDayKeys = new Set<string>();
  const groups = new Map<string, RecentThreadGroup>();

  for (const thread of threads) {
    const dayKey = getLocalDayKey({ timestamp: thread.createdAt });
    const groupKey =
      selectedDayKeys.has(dayKey) || selectedDayKeys.size < 4 ? dayKey : "other";

    if (groupKey === dayKey) {
      selectedDayKeys.add(dayKey);
    }

    const existingGroup = groups.get(groupKey);
    if (existingGroup) {
      existingGroup.threads.push(thread);
      continue;
    }

    groups.set(groupKey, {
      key: groupKey,
      label: groupKey === "other" ? "Other" : formatThreadGroupDate({ timestamp: thread.createdAt }),
      threads: [thread],
    });
  }

  return [...groups.values()];
}

function getLocalDayKey({ timestamp }: { timestamp: number }): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatThreadGroupDate({ timestamp }: { timestamp: number }): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameLocalDay({ first: date, second: today })) return "Today";
  if (isSameLocalDay({ first: date, second: yesterday })) return "Yesterday";

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function isSameLocalDay({ first, second }: { first: Date; second: Date }): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function sameDisplayText({ first, second }: { first: string; second: string }): boolean {
  return normalizeDisplayText({ text: first }) === normalizeDisplayText({ text: second });
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
