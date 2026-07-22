export interface PylonMessage {
  id?: string;
  is_private: boolean;
  message_html?: string;
  source?: string;
  thread_id?: string;
  timestamp?: string;
  author?: { name?: string };
}

export interface PylonIssue {
  id: string;
  number: number;
  title: string;
  state: string;
  source: string;
  tags: string[];
  body_html?: string | null;
  created_at: string;
  updated_at: string;
  type?: string | null;
  account?: { id: string | null } | null;
  assignee?: { id?: string | null; email?: string | null } | null;
  team?: { id?: string | null } | null;
  requester?: { id?: string | null; email?: string | null } | null;
  link?: string | null;
  latest_message_time?: string | null;
  first_response_time?: string | null;
  resolution_time?: string | null;
  customer_portal_visible?: boolean | null;
  custom_fields?: Record<string, { value?: string | null }>;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<pre><code>/gi, "\n```\n")
    .replace(/<\/code><\/pre>/gi, "\n```\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface PylonTextChunk {
  chunkId: string;
  text: string;
  authors: string[];
}

interface Block {
  text: string;
  author?: string;
}

export function buildPylonEmbeddingText(
  issue: PylonIssue,
  messages: PylonMessage[],
  companyName?: string,
  companyDomain?: string,
  maxChars = 800
): PylonTextChunk[] {
  const metadataLines: string[] = [`ISSUE: ${issue.title}`];

  if (companyName) metadataLines.push(`Company: ${companyName}`);
  if (companyDomain) metadataLines.push(`Domain: ${companyDomain}`);
  if (issue.requester?.email) metadataLines.push(`Requester: ${issue.requester.email}`);

  const richFields: string[] = [];
  richFields.push(`State: ${issue.state}`);
  if (issue.type) richFields.push(`Type: ${issue.type}`);
  richFields.push(`Source: ${issue.source}`);

  const priority = issue.custom_fields?.priority?.value;
  if (priority) richFields.push(`Priority: ${priority}`);

  const category = issue.custom_fields?.issue_category?.value;
  if (category) richFields.push(`Category: ${category}`);

  metadataLines.push(richFields.join(" | "));

  if (issue.tags?.length) {
    metadataLines.push(`Tags: ${issue.tags.join(", ")}`);
  }

  const blocks: Block[] = [{ text: metadataLines.join("\n") }];

  if (issue.body_html) {
    blocks.push({ text: stripHtml(issue.body_html) });
  }

  const publicMessages = messages.filter((m) => !m.is_private);
  for (const msg of publicMessages) {
    const author = msg.author?.name ?? "Unknown";
    const text = stripHtml(msg.message_html ?? "");
    if (text) blocks.push({ text: `${author}: ${text}`, author });
  }

  return chunkBlocks(issue.id, blocks, maxChars);
}

function chunkBlocks(
  sourceId: string,
  blocks: Block[],
  maxChars: number
): PylonTextChunk[] {
  const chunks: PylonTextChunk[] = [];
  let current: Block[] = [];
  let currentLen = 0;
  let idx = 0;

  const flush = () => {
    if (!current.length) return;
    const authors = [...new Set(current.map((b) => b.author).filter((a): a is string => !!a))];
    chunks.push({ chunkId: `${sourceId}-${idx++}`, text: current.map((b) => b.text).join("\n\n"), authors });
    current = [];
    currentLen = 0;
  };

  for (const block of blocks) {
    if (currentLen > 0 && currentLen + block.text.length > maxChars) flush();
    current.push(block);
    currentLen += block.text.length;
  }
  flush();
  return chunks;
}
