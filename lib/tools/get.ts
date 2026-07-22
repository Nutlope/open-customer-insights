import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { capToolOutput, type ToolOutputOptions } from "./output";

interface CallItem {
  title: string;
  started: string;
  duration: number;
  companyDomain?: string;
  brief?: string;
  keyPoints?: string[];
  parties?: Array<{
    name: string;
    emailAddress?: string;
  }>;
}

interface IssueItem {
  number: number;
  title: string;
  state: string;
  source: string;
  companyName?: string;
  companyDomain?: string;
  issueCategory?: string;
  priority?: string;
  tags?: string[];
}

interface ChunkItem {
  text: string;
  startSec?: number;
}

interface GetParams {
  convex: ConvexHttpClient;
  clerkId?: string;
  serverSecret?: string;
  id: string;
  outputOptions?: ToolOutputOptions;
}

export async function getTool({ convex, clerkId, serverSecret, id, outputOptions }: GetParams): Promise<string> {
  const colonIdx = id.indexOf(":");
  if (colonIdx === -1) return "Invalid id format. Expected call:<id> or support:<id>.";

  const source = id.slice(0, colonIdx) as "call" | "support";
  const realId = id.slice(colonIdx + 1);

  if (source !== "call" && source !== "support") {
    return "Invalid id format. Expected call:<id> or support:<id>.";
  }

  const result = await convex.query(api.search.getItemDetails, { clerkId, serverSecret, source, id: realId }) as { item: CallItem | IssueItem | null; chunks: ChunkItem[] };

  if (!result.item) return `${source === "call" ? "Call" : "Issue"} not found.`;

  if (source === "call") {
    const call = result.item as CallItem;
    const sortedChunks = result.chunks.sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
    const lines: string[] = [
      `CALL: ${call.title}`,
      `Date: ${new Date(call.started).toLocaleDateString()}`,
      `Duration: ${Math.round(call.duration / 60)} min`,
    ];
    if (call.companyDomain) lines.push(`Company: ${call.companyDomain}`);
    const participants = call.parties
      ?.map((party) => party.name.trim())
      .filter(Boolean);
    if (participants?.length) lines.push(`Participants: ${[...new Set(participants)].join(", ")}`);
    if (call.brief) lines.push(`\nSummary: ${call.brief}`);
    if (call.keyPoints?.length) lines.push(`\nKey Points:\n${call.keyPoints.map((kp) => `• ${kp}`).join("\n")}`);
    lines.push("\n--- TRANSCRIPT ---\n");
    lines.push(sortedChunks.map((c) => c.text).join("\n\n"));
    const output = lines.join("\n");
    return capToolOutput({
      text: output,
      label: "Transcript",
      guidance: "Ask for a narrower section or cite the existing summary and key points.",
      outputOptions,
    });
  } else {
    const issue = result.item as IssueItem;
    const lines: string[] = [
      `ISSUE #${issue.number}: ${issue.title}`,
      `State: ${issue.state} | Source: ${issue.source}`,
    ];
    if (issue.companyName) lines.push(`Company: ${issue.companyName}`);
    if (issue.companyDomain) lines.push(`Domain: ${issue.companyDomain}`);
    if (issue.issueCategory) lines.push(`Category: ${issue.issueCategory}`);
    if (issue.priority) lines.push(`Priority: ${issue.priority}`);
    if (issue.tags?.length) lines.push(`Tags: ${issue.tags.join(", ")}`);
    lines.push("\n--- MESSAGES ---\n");
    lines.push(result.chunks.map((c) => c.text).join("\n\n"));
    const output = lines.join("\n");
    return capToolOutput({
      text: output,
      label: "Issue output",
      guidance: "Ask for a narrower section or use search to find the specific evidence.",
      outputOptions,
    });
  }
}
