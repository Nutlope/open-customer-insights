import type { ReactNode } from "react";

export type CmdkItem =
  | { type: "navigate"; label: string; href: string; icon?: ReactNode; keywords?: string }
  | { type: "company"; label: string; domain: string; status: string; acr?: number }
  | { type: "action"; label: string; onSelect: () => void; icon?: ReactNode; keywords?: string }
  | { type: "copy"; label: string; value: string; icon?: ReactNode }
  | { type: "external"; label: string; href: string; icon?: ReactNode; hidden?: boolean };
