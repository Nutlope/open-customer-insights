import { z } from "zod";
import { COMPETITORS } from "../competitors";

export type CompanyReflectionOutput = {
  narrative: string;
  riskScore: number;
  riskReason: string;
  detectedCompetitors: string[];
};

export const reflectionOutputSchema = z.object({
  narrative: z.string(),
  riskScore: z.number().int().min(0).max(100),
  riskReason: z.string(),
  detectedCompetitors: z.array(z.string()),
});

export type CallSummary = {
  title: string;
  date: string;
  durationMin: number;
  brief?: string;
  keyPoints?: string[];
};

export type TicketSummary = {
  title: string;
  date: string;
  state: string;
  priority?: string;
  category?: string;
};

export type SlackMentionSummary = {
  channel?: string;
  date: string;
  text: string;
  author?: string;
};

export type PreviousReflection = {
  weekStart: string;
  riskScore: number;
  narrative: string;
};

export type ReflectionInput = {
  companyName: string;
  companyDomain: string;
  companyStatus: string;
  weekStart: string;
  weekEnd: string;
  calls: CallSummary[];
  tickets: TicketSummary[];
  slackMentions: SlackMentionSummary[];
  previousReflection?: PreviousReflection;
};

const competitorNames = COMPETITORS.map((c) => c.name).join(", ");

export function buildReflectionPrompt({ input }: { input: ReflectionInput }): string {
  const lines: string[] = [
    "You are a customer success analyst for Together AI (a GPU cloud + AI inference platform).",
    "Analyze the past week's interactions with a company and produce a structured risk assessment.",
    "",
    `Company: ${input.companyName} (${input.companyDomain})`,
    `Status: ${input.companyStatus}`,
    `Week: ${input.weekStart} to ${input.weekEnd}`,
    "",
  ];

  if (input.calls.length > 0) {
    lines.push(`## Gong calls (${input.calls.length})`);
    for (const c of input.calls) {
      lines.push(`- ${c.date} | ${c.title} | ${c.durationMin} min`);
      if (c.brief) lines.push(`  Brief: ${c.brief.slice(0, 400)}`);
      if (c.keyPoints && c.keyPoints.length > 0) {
        lines.push(`  Key points:`);
        for (const kp of c.keyPoints) lines.push(`    • ${kp}`);
      }
    }
  } else {
    lines.push("## Gong calls\nNone this week.");
  }
  lines.push("");

  if (input.tickets.length > 0) {
    lines.push(`## Support tickets (${input.tickets.length})`);
    for (const t of input.tickets) {
      const parts = [t.date, t.title, t.state];
      if (t.priority) parts.push(`priority: ${t.priority}`);
      if (t.category) parts.push(t.category);
      lines.push(`- ${parts.join(" | ")}`);
    }
  } else {
    lines.push("## Support tickets\nNone this week.");
  }
  lines.push("");

  if (input.slackMentions.length > 0) {
    lines.push(`## Internal Slack mentions (Together AI team only — not customer communications)`);
    for (const s of input.slackMentions) {
      const prefix = [s.date, s.channel ? `#${s.channel}` : null, s.author]
        .filter(Boolean)
        .join(" | ");
      lines.push(`- ${prefix}: ${s.text.slice(0, 200)}`);
    }
  } else {
    lines.push("## Internal Slack mentions\nNone this week.");
  }
  lines.push("");

  if (input.previousReflection) {
    lines.push("## Previous week context");
    lines.push(`Week: ${input.previousReflection.weekStart}`);
    lines.push(`Risk score: ${input.previousReflection.riskScore}`);
    lines.push(`Summary: ${input.previousReflection.narrative}`);
    lines.push("");
    lines.push(
      "IMPORTANT: If the previous risk score was 80 or higher, the relationship is already severely damaged or the customer has already left.",
      "Only lower the risk score significantly if there is clear direct re-engagement from the customer this week — a new Gong call with the customer, a new inbound support ticket from the customer, or an explicit positive signal.",
      "Internal Slack post-mortems or internal team discussions about a lost account do NOT count as re-engagement and should NOT reduce the risk score.",
    );
    lines.push("");
  }

  lines.push("## Known competitors");
  lines.push(competitorNames);
  lines.push("");

  lines.push("## Instructions");
  lines.push(
    "Return a JSON object with exactly these fields:",
    "",
    '- "narrative": 1-2 sentences. Write like an account manager jotting a weekly note — capture the THEME and SENTIMENT of the week, not a list of events.',
    "  Hard rules:",
    '  • NEVER mention counts of any kind. Bad: "seven tickets", "two calls", "three issues". Good: describe what was happening thematically.',
    '  • NEVER mention ticket or issue status. Bad: "all tickets closed", "issues resolved", "waiting on customer". Those go stale immediately.',
    '  • NEVER mention the absence of anything. Bad: "no calls this week", "no Slack activity". Only describe what DID happen.',
    '  • Focus on the customer\'s mood, intent, and the overarching story — what were they trying to accomplish, what friction did they hit, how does the relationship feel?',
    "  Bad example: \"Revolut submitted six support requests spanning legal markup reviews, SLA monitoring, billing exports, and GPU reservations. All tickets closed at medium priority.\"",
    "  Good example: \"Revolut pushed hard on commercial terms — SLA clauses, pricing caps, and GPU capacity guarantees — signaling they're serious about closing but need contractual assurances first.\"",
    "",
    '- "riskScore": integer 0-100. 0 = extremely healthy, 100 = churned/lost.',
    "  Calibration anchors:",
    "  • Customer explicitly chose a competitor → 95+",
    "  • Failed POC, customer marked results as failed → 90+",
    "  • POC concluded with no follow-up commitment → 75+",
    "  • Multiple urgent infra outages, no resolution → 70+",
    "  • Active positive sales calls, deal progressing → 15-30",
    "  • Only Slack signals, no calls or tickets → 20-40 max",
    "  • Single low-priority ticket → 20-35",
    "",
    '- "riskReason": one tight sentence — the single biggest driver. Name the specific event, decision, or pattern. No hedging.',
    "",
    '- "detectedCompetitors": array of competitor names from the Known competitors list that this company is evaluating INSTEAD OF or switching TO over Together AI.',
    '  • Only flag a competitor if the customer is considering it as an alternative to Together AI.',
    '  • Do NOT flag incumbents the customer is replacing with Together AI. Bad: "we want to cut our OpenAI bills" → do not flag OpenAI.',
    '  • Do flag: "we are also evaluating Fireworks" or "we decided to go with Groq".',
    '  • Empty array if none — do not guess.',
  );

  return lines.join("\n");
}
