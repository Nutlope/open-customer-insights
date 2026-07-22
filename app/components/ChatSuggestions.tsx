"use client";

import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { SourceBadgeIcon, type SourceVisualKey } from "./sourceVisuals";

const suggestions = [
  {
    source: "daily",
    displayPrompt: "What are the latest daily insights?",
    prompt: "What are the latest daily insights?",
  },
  {
    source: "calls",
    displayPrompt: "What are the top signals from recent calls?",
    prompt: "What are the top customer signals from recent calls?",
  },
  {
    source: "tickets",
    displayPrompt: "What ticket issues are blocking customers?",
    prompt: "What support ticket issues are blocking customers this week?",
  },
  {
    source: "slack",
    displayPrompt: "What does Slack say about Revolut recently?",
    prompt: "What does Slack say about Revolut recently?",
  },
] as const satisfies ReadonlyArray<{
  source: SourceVisualKey;
  displayPrompt: string;
  prompt: string;
}>;

export default function ChatSuggestions({
  className,
  onPromptSelect,
}: {
  className: string;
  onPromptSelect: ({ prompt }: { prompt: string }) => void;
}) {
  return (
    <Suggestions className={`${className} grid grid-cols-1 gap-1.5 px-3 sm:grid-cols-2 sm:gap-2`}>
      {suggestions.map((suggestion, index) => (
        <Suggestion
          key={suggestion.prompt}
          className={`${index > 1 ? "hidden sm:flex" : ""} h-auto min-w-0 max-w-full justify-start rounded-full border-zinc-200/70 bg-white/70 px-2.5 py-1.5 text-left text-xs font-medium text-zinc-500 shadow-none transition-[background-color,border-color,color,transform] hover:border-zinc-300 hover:bg-white hover:text-zinc-800 active:scale-[0.98]`}
          onClick={() => onPromptSelect({ prompt: suggestion.prompt })}
          suggestion={suggestion.prompt}
        >
          <SourceBadgeIcon source={suggestion.source} className="mr-2" />
          <span className="min-w-0 truncate">{suggestion.displayPrompt}</span>
        </Suggestion>
      ))}
    </Suggestions>
  );
}
