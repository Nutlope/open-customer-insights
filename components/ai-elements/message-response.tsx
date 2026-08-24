"use client";

import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
  /* "default" is the chat body voice; "compact" is the quiet small-type voice
     used inside thinking traces and other secondary surfaces. The two are
     complete class lists rather than override stacks, because conflicting
     arbitrary variants resolve by stylesheet order, not className order. */
  variant?: "default" | "compact";
};

const streamdownPlugins = { cjk, code, math, mermaid };
const inlineMarkdownControls: NonNullable<MessageResponseProps["controls"]> = {
  table: { fullscreen: false },
  mermaid: { fullscreen: false },
};

/* Word-level reveal while tokens stream in. Only active while isAnimating is
   true; completed messages render as plain text with no animation overhead. */
const streamingReveal: MessageResponseProps["animated"] = {
  animation: "fadeIn",
  duration: 260,
  easing: "ease-out",
  sep: "word",
};

const variantClassNames: Record<NonNullable<MessageResponseProps["variant"]>, string> = {
  default: cn(
    "size-full text-base leading-relaxed",
    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
    "[&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-medium",
    "[&_h1]:mt-6 [&_h2]:mt-5 [&_h3]:mt-4 [&_h1]:mb-2 [&_h2]:mb-1.5 [&_h3]:mb-1",
    "[&_p]:my-2.5",
    "[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
    "[&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5",
    "[&_li]:pl-1 [&_li>p]:my-1",
    "[&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-600",
    "[&_code]:rounded [&_code]:bg-zinc-200/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.86em]",
    "[&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-950 [&_pre]:p-3 [&_pre]:text-sm [&_pre]:text-zinc-50 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
    "[&_table]:text-sm",
    "[&_hr]:my-5 [&_hr]:border-zinc-200",
  ),
  compact: cn(
    "size-full text-sm leading-6 text-zinc-500",
    "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
    "[&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium",
    "[&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_h1]:mb-1 [&_h2]:mb-1 [&_h3]:mb-1",
    "[&_p]:my-1.5",
    "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-4",
    "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-4",
    "[&_li]:pl-0.5 [&_li>p]:my-0.5",
    "[&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-2.5 [&_blockquote]:text-zinc-500",
    "[&_code]:rounded [&_code]:bg-zinc-200/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
    "[&_pre]:my-2 [&_pre]:max-h-56 [&_pre]:max-w-full [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-white [&_pre]:p-2 [&_pre]:text-xs [&_pre]:text-zinc-700 [&_pre]:border [&_pre]:border-zinc-200/80 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
    "[&_table]:text-xs",
  ),
};

export const MessageResponse = memo(
  ({
    className,
    controls = inlineMarkdownControls,
    isAnimating = false,
    variant = "default",
    ...props
  }: MessageResponseProps) => (
    <Streamdown
      className={cn(variantClassNames[variant], className)}
      controls={controls}
      plugins={streamdownPlugins}
      animated={streamingReveal}
      isAnimating={isAnimating}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.isAnimating === nextProps.isAnimating &&
    prevProps.components === nextProps.components &&
    prevProps.className === nextProps.className &&
    prevProps.variant === nextProps.variant,
);

MessageResponse.displayName = "MessageResponse";
