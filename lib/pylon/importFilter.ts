import { stripHtml, type PylonIssue, type PylonMessage } from "../embedding/pylon/text";

export type PylonImportFilterReason =
  | "mass_outbound_notice"
  | "csat_feedback_email"
  | "delivery_bounce"
  | "outbound_invoice_or_payment_notice"
  | "recruiting_or_job_application"
  | "sales_or_vendor_spam"
  | "empty_title_without_meaningful_body";

export interface PylonImportFilterDecision {
  shouldImport: boolean;
  reasons: PylonImportFilterReason[];
}

export type PylonImportFilterMode = "default" | "historicalStrict";

export interface ShouldImportPylonIssueParams {
  issue: PylonIssue;
  messages?: PylonMessage[];
  mode?: PylonImportFilterMode;
}

const MASS_OUTBOUND_TITLE_RE =
  /^(Important Notice|Final Notice|Upcoming Price Change|Important Update: Fine-Tuning Pricing Minimum|Revocation of legacy API key)\b/i;

const CSAT_TEMPLATE_RE =
  /we.d love to get your feedback|portal\.usepylon\.com\/together-ai\/csat|static\.usepylon\.com\/(disappointed|confused|neutral_face|slightly_smiling_face|grin)/i;

const DELIVERY_BOUNCE_RE =
  /delivery status notification|undeliverable|mail delivery failed|returned mail|message blocked/i;

const OUTBOUND_INVOICE_OR_PAYMENT_NOTICE_RE =
  /^(\[Action Required\] Failed Payment|Your Historical Together AI Invoices)$/i;

const HISTORICAL_OUTBOUND_INVOICE_OR_PAYMENT_NOTICE_RE =
  /your historical together ai invoices|^\[action required\] failed payment$|failed payment|invoice/i;

const RECRUITING_OR_JOB_APPLICATION_RE =
  /software engineer|full stack|resume|curriculum vitae|\bcv\b|job application|immediate join|spring 20\d{2} grad/i;

const SALES_OR_VENDOR_SPAM_RE =
  /partnership proposal|sponsorship|guest post|seo|lead generation|salesforce|free lora lens|gpu development access|offer collaboration|ship today:|stock and can ship today|strategic white-label technology partnership/i;

const MEANINGFUL_BODY_MIN_CHARS = 60;

function buildFilterText({ issue, messages }: ShouldImportPylonIssueParams): string {
  const publicMessages = messages?.filter((message) => !message.is_private) ?? [];
  const messageText = publicMessages
    .map((message) => stripHtml(message.message_html ?? ""))
    .filter(Boolean)
    .join("\n");

  return [
    issue.title,
    stripHtml(issue.body_html ?? ""),
    messageText,
  ]
    .filter(Boolean)
    .join("\n");
}

export function shouldImportPylonIssue({
  issue,
  messages,
  mode = "default",
}: ShouldImportPylonIssueParams): PylonImportFilterDecision {
  const title = issue.title.trim();
  const text = buildFilterText({ issue, messages });
  const isHistoricalStrict = mode === "historicalStrict";
  const reasons: PylonImportFilterReason[] = [];

  if (MASS_OUTBOUND_TITLE_RE.test(title)) {
    reasons.push("mass_outbound_notice");
  }
  if (CSAT_TEMPLATE_RE.test(text)) {
    reasons.push("csat_feedback_email");
  }
  if (DELIVERY_BOUNCE_RE.test(`${title}\n${text}`)) {
    reasons.push("delivery_bounce");
  }
  if (
    OUTBOUND_INVOICE_OR_PAYMENT_NOTICE_RE.test(title) ||
    (isHistoricalStrict && HISTORICAL_OUTBOUND_INVOICE_OR_PAYMENT_NOTICE_RE.test(title))
  ) {
    reasons.push("outbound_invoice_or_payment_notice");
  }
  if (RECRUITING_OR_JOB_APPLICATION_RE.test(title)) {
    reasons.push("recruiting_or_job_application");
  }
  if (SALES_OR_VENDOR_SPAM_RE.test(`${title}\n${text}`)) {
    reasons.push("sales_or_vendor_spam");
  }
  if (!title && (isHistoricalStrict || text.length < MEANINGFUL_BODY_MIN_CHARS)) {
    reasons.push("empty_title_without_meaningful_body");
  }

  return {
    shouldImport: reasons.length === 0,
    reasons,
  };
}
