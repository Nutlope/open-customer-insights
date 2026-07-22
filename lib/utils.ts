import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractDomain(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const parts = email.split("@");
  return parts.length === 2 ? parts[1] : undefined;
}

export interface InsertChunkArgs {
  dataSource: string;
  sourceId: string;
  chunkId: string;
  text: string;
  companyDomain?: string;
  ingestedAt: string;
  startSec?: number;
  endSec?: number;
  speakers?: string[];
  // Gong-only: distinct participant names bucketed by Gong `affiliation`.
  // "Unknown" affiliation lands in neither array (only in `speakers`).
  internalSpeakers?: string[];
  externalSpeakers?: string[];
  authors?: string[];
  embedding: number[];
}

export interface DeleteChunksArgs {
  dataSource: string;
  sourceId: string;
  currentIngestedAt: string;
}

export type UpsertChunkTextArgs = Omit<InsertChunkArgs, "embedding">;

export interface SharedStoreDb {
  upsertChunkText(args: UpsertChunkTextArgs): Promise<unknown>;
  deleteOtherChunks(args: DeleteChunksArgs): Promise<unknown>;
}
