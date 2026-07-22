"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CmdkItem } from "@/lib/cmdk/types";

interface CmdkContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  contextItems: CmdkItem[];
  registerItems: (params: { key: string; items: CmdkItem[] }) => void;
  unregisterItems: (params: { key: string }) => void;
}

const CmdkContext = createContext<CmdkContextValue | null>(null);

export function CmdkProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [itemsByKey, setItemsByKey] = useState<Map<string, CmdkItem[]>>(new Map());

  const registerItems = useCallback(({ key, items }: { key: string; items: CmdkItem[] }) => {
    setItemsByKey((prev) => {
      const next = new Map(prev);
      next.set(key, items);
      return next;
    });
  }, []);

  const unregisterItems = useCallback(({ key }: { key: string }) => {
    setItemsByKey((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const contextItems = useMemo(() => Array.from(itemsByKey.values()).flat(), [itemsByKey]);

  const value = useMemo<CmdkContextValue>(
    () => ({ open, setOpen, contextItems, registerItems, unregisterItems }),
    [open, contextItems, registerItems, unregisterItems],
  );

  return <CmdkContext.Provider value={value}>{children}</CmdkContext.Provider>;
}

export function useCmdkController(): CmdkContextValue {
  const ctx = useContext(CmdkContext);
  if (!ctx) throw new Error("useCmdkController must be used within a CmdkProvider");
  return ctx;
}

export function useCmdkContext({ items, key }: { items: CmdkItem[]; key: string }) {
  const { registerItems, unregisterItems } = useCmdkController();

  useEffect(() => {
    registerItems({ key, items });
    return () => unregisterItems({ key });
  }, [items, key, registerItems, unregisterItems]);
}
