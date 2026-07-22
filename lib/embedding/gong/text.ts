import type { GongAffiliation, GongSpeakerInfo } from "../../gong/api";

export interface GongTextChunk {
  chunkId: string;
  text: string;
  startSec: number;
  endSec: number;
  speakers: string[];
  internalSpeakers: string[];
  externalSpeakers: string[];
}

interface NormalizedGongCall {
  id: string;
  title: string;
  started: string;
  duration: number;
  scope?: string;
  system?: string;
  scheduled?: string;
}

interface GongTranscriptSentence {
  text: string;
  start: number;
  end: number;
}

interface GongTranscriptEntry {
  speakerId: string;
  sentences: GongTranscriptSentence[];
}

interface Block {
  text: string;
  startSec: number;
  endSec: number;
  speakers: string[];
  internalSpeakers: string[];
  externalSpeakers: string[];
}

export function buildGongEmbeddingText(
  call: NormalizedGongCall,
  transcript: GongTranscriptEntry[],
  speakerMap: Map<string, GongSpeakerInfo>,
  brief?: string,
  keyPoints?: string[],
  topics?: { name: string; duration: number }[],
  companyDomain?: string,
  maxChars = 800
): GongTextChunk[] {
  const blocks: Block[] = [];

  // ── metadata block ──────────────────────────────────────────────────────────
  const title = call.title ?? "Untitled call";
  const started = call.started ?? call.scheduled ?? "";
  const durationMin = call.duration ? Math.round(call.duration / 60) : undefined;

  const metaLines = [`CALL: ${title}`];
  if (companyDomain) metaLines.push(`Company: ${companyDomain}`);
  if (started) metaLines.push(`Date: ${started}`);
  if (durationMin != null) metaLines.push(`Duration: ${durationMin} min`);
  if (call.scope) metaLines.push(`Scope: ${call.scope}`);
  if (call.system) metaLines.push(`System: ${call.system}`);
  if (topics?.length) metaLines.push(`Topics: ${topics.map((t) => `${t.name} (${Math.round(t.duration / 60)}min)`).join(", ")}`);
  if (brief) metaLines.push(`\nBrief: ${brief}`);
  if (keyPoints?.length) metaLines.push(`\nKey Points:\n${keyPoints.map((kp) => `- ${kp}`).join("\n")}`);

  blocks.push({
    text: metaLines.join("\n"),
    startSec: 0,
    endSec: 0,
    speakers: [],
    internalSpeakers: [],
    externalSpeakers: [],
  });

  // ── transcript blocks ─────────────────────────────────────────────────────
  for (const entry of transcript) {
    const info = speakerMap.get(entry.speakerId);
    const name = info?.name ?? `Speaker ${entry.speakerId}`;
    const affiliation: GongAffiliation = info?.affiliation ?? "Unknown";
    const lineText = (entry.sentences ?? [])
      .map((s) => s.text)
      .join(" ")
      .trim();
    if (!lineText) continue;

    const s = entry.sentences?.[0]?.start ?? 0;
    const e = entry.sentences?.[entry.sentences.length - 1]?.end ?? 0;

    blocks.push({
      text: `${name}: ${lineText}`,
      startSec: s,
      endSec: e,
      speakers: [name],
      // Affiliation buckets the speaker for post-retrieval labeling. "Unknown"
      // speakers land in neither bucket (only in `speakers`) so they render as
      // "(Unverified)" at search time without ever counting as internal.
      internalSpeakers: affiliation === "Internal" ? [name] : [],
      externalSpeakers: affiliation === "External" ? [name] : [],
    });
  }

  return chunkBlocks(call.id, blocks, maxChars);
}

function chunkBlocks(
  sourceId: string,
  blocks: Block[],
  maxChars: number
): GongTextChunk[] {
  const chunks: GongTextChunk[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let startSec = 0;
  let endSec = 0;
  const speakers = new Set<string>();
  const internalSpeakers = new Set<string>();
  const externalSpeakers = new Set<string>();
  let idx = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push({
      chunkId: `${sourceId}-${idx++}`,
      text: current.join("\n\n"),
      startSec,
      endSec,
      speakers: Array.from(speakers),
      internalSpeakers: Array.from(internalSpeakers),
      externalSpeakers: Array.from(externalSpeakers),
    });
    current = [];
    currentLen = 0;
    speakers.clear();
    internalSpeakers.clear();
    externalSpeakers.clear();
  };

  for (const block of blocks) {
    if (currentLen > 0 && currentLen + block.text.length > maxChars) {
      flush();
    }
    if (current.length === 0) startSec = block.startSec;
    endSec = block.endSec;
    block.speakers.forEach((s) => speakers.add(s));
    block.internalSpeakers.forEach((s) => internalSpeakers.add(s));
    block.externalSpeakers.forEach((s) => externalSpeakers.add(s));
    current.push(block.text);
    currentLen += block.text.length;
  }

  flush();
  return chunks;
}
