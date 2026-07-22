"use client";

import { useCallback, useEffect, useState } from "react";
import { SparklesIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SourceBadgeIcon, type SourceVisualKey } from "./sourceVisuals";

const FEATURE_UPDATES_STORAGE_KEY = "customer-insights-feature-updates-dismissed";

const featureUpdates = [
  {
    id: "slack-search",
    source: "slack",
    title: "Slack search is available",
    description: "Ask across joined Slack channels and threads for live internal context about companies and customers.",
  },
  {
    id: "daily-insights-chat",
    source: "daily",
    title: "Daily insights are searchable in chat",
    description: "Ask for recent daily reports, customer signals, source-backed learnings, and insight status by date or company.",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  source: SourceVisualKey;
  title: string;
  description: string;
}>;

type FeatureUpdateId = (typeof featureUpdates)[number]["id"];

function isFeatureUpdateId(value: unknown): value is FeatureUpdateId {
  return typeof value === "string" && featureUpdates.some((update) => update.id === value);
}

function readDismissedIds(): Set<FeatureUpdateId> {
  try {
    const raw = window.localStorage.getItem(FEATURE_UPDATES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(isFeatureUpdateId));
  } catch {
    return new Set();
  }
}

function writeDismissedIds({ ids }: { ids: Set<FeatureUpdateId> }): void {
  try {
    window.localStorage.setItem(FEATURE_UPDATES_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {}
}

export default function FeatureUpdatesStack() {
  const shouldReduceMotion = useReducedMotion();
  const [dismissedIds, setDismissedIds] = useState<Set<FeatureUpdateId>>(() => new Set());
  const [hasLoadedDismissals, setHasLoadedDismissals] = useState(false);

  useEffect(() => {
    setDismissedIds(readDismissedIds());
    setHasLoadedDismissals(true);
  }, []);

  const dismissUpdate = useCallback(({ id }: { id: FeatureUpdateId }) => {
    setDismissedIds((current) => {
      const next = new Set(current);
      next.add(id);
      writeDismissedIds({ ids: next });
      return next;
    });
  }, []);

  const visibleUpdates = featureUpdates.filter((update) => !dismissedIds.has(update.id));
  if (!hasLoadedDismissals || visibleUpdates.length === 0) return null;

  return (
    <div className="mx-auto mt-4 w-full max-w-[520px] text-left">
      <div className="mb-2 flex items-center justify-center gap-1.5 text-xs font-medium text-zinc-400">
        <SparklesIcon className="size-3.5" />
        Product updates
      </div>
      <div className="relative h-[104px] [perspective:900px]">
        <AnimatePresence initial={false}>
          {visibleUpdates.map((update, index) => {
            const depth = Math.min(index, 3);
            const isTopCard = index === 0;
            return (
              <motion.div
                key={update.id}
                aria-hidden={!isTopCard}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 12, scale: 0.96 }}
                animate={{
                  opacity: isTopCard ? 1 : Math.max(0.42, 0.72 - depth * 0.14),
                  y: shouldReduceMotion ? 0 : depth * 10,
                  scale: shouldReduceMotion ? 1 : 1 - depth * 0.038,
                  rotateX: shouldReduceMotion ? 0 : depth * -1.4,
                }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
                transition={{ type: "spring", duration: 0.28, bounce: 0, delay: shouldReduceMotion ? 0 : index * 0.025 }}
                className={`absolute inset-x-0 top-0 ${isTopCard ? "pointer-events-auto" : "pointer-events-none"}`}
                style={{
                  zIndex: visibleUpdates.length - index,
                  transformOrigin: "top center",
                }}
              >
                <div
                  className={`group flex min-h-[88px] items-start gap-2.5 rounded-xl bg-white/95 p-3 backdrop-blur transition-[box-shadow,transform] ${
                    isTopCard
                      ? "shadow-[0_18px_44px_rgba(24,24,27,0.10),0_2px_6px_rgba(24,24,27,0.06),0_0_0_1px_rgb(228_228_231)] hover:shadow-[0_24px_58px_rgba(24,24,27,0.13),0_2px_6px_rgba(24,24,27,0.06),0_0_0_1px_rgb(212_212_216)]"
                      : "shadow-[0_12px_34px_rgba(24,24,27,0.10),0_0_0_1px_rgba(228,228,231,0.9)]"
                  }`}
                >
                  {isTopCard && (
                    <>
                      <SourceBadgeIcon
                        source={update.source}
                        className="mt-0.5 size-8 rounded-md shadow-[inset_0_0_0_1px_rgba(24,24,27,0.06)]"
                        iconClassName="size-4"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-5 text-zinc-950">{update.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-pretty text-xs leading-5 text-zinc-500">{update.description}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Dismiss ${update.title}`}
                        onClick={() => dismissUpdate({ id: update.id })}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-[background-color,color,transform] hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.96]"
                      >
                        <XIcon className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
