"use client";

import { useState } from "react";
import { isPlaceholderDomain } from "@/lib/domain/placeholderDomain";

function faviconUrl({ domain }: { domain: string }): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function initial({ name }: { name: string }): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function CompanyLogo({
  domain,
  name,
  size = "size-9",
  rounded = "rounded-md",
  textSize = "text-sm",
}: {
  domain?: string;
  name: string;
  size?: string;
  rounded?: string;
  textSize?: string;
}) {
  const [errored, setErrored] = useState(false);
  const showFavicon = !!domain && !isPlaceholderDomain({ domain }) && !errored;

  return (
    <span className={`flex ${size} shrink-0 items-center justify-center overflow-hidden ${rounded} bg-zinc-100 ring-1 ring-zinc-200`}>
      {showFavicon ? (
        <img
          src={faviconUrl({ domain: domain! })}
          alt=""
          className="size-full object-contain"
          loading="lazy"
          onError={() => setErrored(true)}
        />
      ) : (
        <span className={`font-semibold text-zinc-500 ${textSize}`}>{initial({ name })}</span>
      )}
    </span>
  );
}
