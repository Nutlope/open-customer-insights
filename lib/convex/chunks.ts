/**
 * Convex-bundle-safe pure helpers for chunk metadata. Kept in `lib/convex/`
 * (not `lib/utils.ts`) because the latter imports `clsx`/`tailwind-merge`,
 * which must not be pulled into the convex server bundle.
 *
 * @module
 */

/**
 * Order-insensitive equality for optional string arrays (speaker buckets,
 * authors, etc.). Treats `undefined` and `[]` as equivalent — a chunk that
 * stores `internalSpeakers: []` is considered unchanged vs. an absent field.
 */
export function stringArraysEqual({
  a,
  b,
}: {
  a: string[] | undefined;
  b: string[] | undefined;
}): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  for (const value of left) {
    if (!rightSet.has(value)) return false;
  }
  return true;
}
