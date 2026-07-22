"use client";

import { useState } from "react";

export function CompetitorLogo({
  name,
  domain,
  size = 32,
}: {
  name: string;
  domain: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="flex flex-shrink-0 items-center justify-center rounded bg-zinc-100 text-[10px] font-semibold text-zinc-500"
        style={{ width: size, height: size, minWidth: size }}
      >
        {name[0]?.toUpperCase()}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://logos.hunter.io/${domain}`}
      alt={name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="rounded object-contain flex-shrink-0"
      style={{ width: size, height: size, minWidth: size }}
    />
  );
}
