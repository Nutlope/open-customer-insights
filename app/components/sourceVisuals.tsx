import {
  Building2Icon,
  CalendarDaysIcon,
  HeadphonesIcon,
  MessageSquareIcon,
  SwordsIcon,
  UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SourceVisualKey = "daily" | "prospects" | "calls" | "tickets" | "slack" | "competitors" | "companies";

type SourceIconProps = {
  className?: string;
  strokeWidth?: number;
};

type SourceVisual = {
  label: string;
  textClassName: string;
  badgeClassName: string;
  renderIcon: ({ className, strokeWidth }: SourceIconProps) => React.ReactNode;
};

function SlackLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 127 127" className={className} aria-hidden="true">
      <path
        d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"
        fill="#E01E5A"
      />
      <path
        d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z"
        fill="#36C5F0"
      />
      <path
        d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z"
        fill="#2EB67D"
      />
      <path
        d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z"
        fill="#ECB22E"
      />
    </svg>
  );
}

export const sourceVisuals: Record<SourceVisualKey, SourceVisual> = {
  daily: {
    label: "Daily",
    textClassName: "text-sky-700",
    badgeClassName: "bg-sky-50 text-sky-700 ring-sky-100",
    renderIcon: ({ className, strokeWidth = 2 }) => (
      <CalendarDaysIcon className={className} strokeWidth={strokeWidth} />
    ),
  },
  prospects: {
    label: "Prospects",
    textClassName: "text-emerald-700",
    badgeClassName: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    renderIcon: ({ className, strokeWidth = 2 }) => (
      <UsersIcon className={className} strokeWidth={strokeWidth} />
    ),
  },
  calls: {
    label: "Calls",
    textClassName: "text-violet-700",
    badgeClassName: "bg-violet-50 text-violet-700 ring-violet-100",
    renderIcon: ({ className, strokeWidth = 2 }) => (
      <HeadphonesIcon className={className} strokeWidth={strokeWidth} />
    ),
  },
  tickets: {
    label: "Tickets",
    textClassName: "text-amber-700",
    badgeClassName: "bg-amber-50 text-amber-700 ring-amber-100",
    renderIcon: ({ className, strokeWidth = 2 }) => (
      <MessageSquareIcon className={className} strokeWidth={strokeWidth} />
    ),
  },
  slack: {
    label: "Slack",
    textClassName: "text-zinc-700",
    badgeClassName: "bg-white text-zinc-700 ring-zinc-200",
    renderIcon: ({ className }) => <SlackLogo className={className} />,
  },
  competitors: {
    label: "Competitors",
    textClassName: "text-rose-700",
    badgeClassName: "bg-rose-50 text-rose-700 ring-rose-100",
    renderIcon: ({ className, strokeWidth = 2 }) => <SwordsIcon className={className} strokeWidth={strokeWidth} />,
  },
  companies: {
    label: "Companies",
    textClassName: "text-blue-700",
    badgeClassName: "bg-blue-50 text-blue-700 ring-blue-100",
    renderIcon: ({ className, strokeWidth = 2 }) => (
      <Building2Icon className={className} strokeWidth={strokeWidth} />
    ),
  },
};

export function SourceIcon({
  source,
  className,
  strokeWidth,
}: {
  source: SourceVisualKey;
  className?: string;
  strokeWidth?: number;
}) {
  return sourceVisuals[source].renderIcon({
    className: cn("size-3.5", sourceVisuals[source].textClassName, className),
    strokeWidth,
  });
}

export function SourceBadgeIcon({
  source,
  className,
  iconClassName,
}: {
  source: SourceVisualKey;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full ring-1",
        sourceVisuals[source].badgeClassName,
        className,
      )}
    >
      <SourceIcon source={source} className={cn("size-3.5", iconClassName)} />
    </span>
  );
}
