import type { Doc } from "../../convex/_generated/dataModel";
import type { QueryCtx } from "../../convex/_generated/server";

export type SourcePerson = { name?: string; email?: string };
export type SourceDetailResult = {
  source: "call" | "support";
  title: string;
  companyDomain?: string;
  date?: string;
  people: SourcePerson[];
  internalPeople?: SourcePerson[];
  sections: Array<{ title: string; text: string }>;
  url?: string;
};

export function stripSourcePrefix({ id }: { id: string }): string {
  return id.replace(/^(call|support):/, "").split("|")[0]!.trim();
}

export function sourceUrl({ source, id }: { source: "call" | "support"; id: string }): string | undefined {
  if (source !== "call") return undefined;
  return `https://app.gong.io/call?id=${encodeURIComponent(stripSourcePrefix({ id }))}`;
}

function chunkNumericSuffix({ chunkId }: { chunkId: string }): number {
  const match = chunkId.match(/-(\d+)$/);
  return match ? Number.parseInt(match[1]!, 10) : Number.POSITIVE_INFINITY;
}

export function compareTranscriptChunks({ a, b }: { a: Doc<"chunks">; b: Doc<"chunks"> }): number {
  const startDelta = (a.startSec ?? Number.POSITIVE_INFINITY) - (b.startSec ?? Number.POSITIVE_INFINITY);
  if (startDelta !== 0) return startDelta;
  const endDelta = (a.endSec ?? Number.POSITIVE_INFINITY) - (b.endSec ?? Number.POSITIVE_INFINITY);
  if (endDelta !== 0) return endDelta;
  const indexDelta = chunkNumericSuffix({ chunkId: a.chunkId }) - chunkNumericSuffix({ chunkId: b.chunkId });
  return indexDelta !== 0 ? indexDelta : a.chunkId.localeCompare(b.chunkId);
}

export function dedupePeople({ people, limit = 3 }: { people: SourcePerson[]; limit?: number }): SourcePerson[] {
  const seen = new Set<string>();
  return people.filter((person) => {
    const key = (person.email ?? person.name ?? "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function normalizedName({ value }: { value?: string }): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function nameParts({ value }: { value?: string }): string[] {
  return normalizedName({ value }).split(/\s+/).filter((part) => part.length >= 3);
}

function matchesSpeaker({ speaker, person }: { speaker: string; person: SourcePerson }): boolean {
  const normalizedSpeaker = normalizedName({ value: speaker });
  const personName = normalizedName({ value: person.name });
  if (personName.length >= 3 && (normalizedSpeaker.includes(personName) || personName.includes(normalizedSpeaker))) return true;
  const personParts = nameParts({ value: person.name });
  if (personParts.length >= 2 && personParts.every((part) => normalizedSpeaker.includes(part))) return true;
  const emailParts = nameParts({ value: person.email?.split("@")[0] });
  return emailParts.length >= 2
    ? emailParts.every((part) => normalizedSpeaker.includes(part))
    : emailParts.length === 1 && normalizedSpeaker === emailParts[0];
}

export async function getInternalPeopleForSpeakers({
  ctx,
  speakerNames,
  limit = 30,
}: {
  ctx: QueryCtx;
  speakerNames: string[];
  limit?: number;
}): Promise<SourcePerson[]> {
  const names = [...new Set(speakerNames.map((speaker) => speaker.trim()).filter(Boolean))];
  if (names.length === 0) return [];
  const users = await ctx.db.query("slackUserCache").collect();
  const people = users
    .filter((user) => !user.deleted && !user.isBot && !user.isRestricted && !user.isUltraRestricted && !user.isStranger)
    .map((user) => ({ name: user.realName ?? user.displayName ?? user.username, email: user.email }))
    .filter((person) => names.some((speaker) => matchesSpeaker({ speaker, person })));
  return dedupePeople({ people, limit });
}

export function cleanPylonChunkText({ text }: { text: string }): string {
  const metadataPrefixes = ["ISSUE:", "Company:", "Domain:", "State:", "Tags:", "Requester:", "Assignee:", "Priority:", "Category:"];
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => !metadataPrefixes.some((prefix) => line.startsWith(prefix)));
  if (!lines.some((line) => /^[^:]{2,80}: /.test(line))) return lines.join("\n\n");
  return lines.filter((line) => /^[^:]{2,80}: /.test(line)).join("\n\n");
}
