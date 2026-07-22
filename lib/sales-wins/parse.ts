// Parses "Opportunity closed won" Salesforce-for-Slack notifications (as
// exported by scripts/export-slack-channel.ts) into structured deal records.

// How effectiveAcr was derived:
// - "explicit": ACR field reported directly on the deal.
// - "estimated": derived from amount / (termLengthDays / 365).
// - "assumed_annual": no ACR or term length, amount used as-is (only safe for small deals).
// - "flagged_review": same as assumed_annual but amount exceeds FLAG_THRESHOLD —
//   likely a multi-year total contract value, not an annual run-rate.
export type AcrConfidence = "explicit" | "estimated" | "assumed_annual" | "flagged_review";

// Amount-only deals (no ACR, no term length) above this are flagged for
// manual review rather than assumed to be a 1-year run-rate.
export const FLAG_THRESHOLD = 500_000;

export type SalesWinDeal = {
  ts: string;
  date: string;
  year: number;
  opportunityName?: string;
  opportunityUrl?: string;
  ownerAE?: string;
  cx: string[];
  company: string;
  companyKey: string;
  companyUrl?: string;
  amount: number | null;
  acr: number | null;
  termLengthDays: number | null;
  opportunityType?: string;
  businessUseCase?: string;
  maxGpuPrice: number | null;
  effectiveAcr: number | null;
  acrConfidence: AcrConfidence | null;
};

type SlackExportMessage = {
  ts: string;
  timestamp?: string;
  text?: string;
  rawText?: string;
  botId?: string;
};

const FIELD_RE_CACHE = new Map<string, RegExp>();

function fieldValue({ rawText, label }: { rawText: string; label: string }): string | undefined {
  let re = FIELD_RE_CACHE.get(label);
  if (!re) {
    re = new RegExp(`&gt;\\*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\*\\s*([^\n]*)`);
    FIELD_RE_CACHE.set(label, re);
  }
  const match = rawText.match(re);
  return match?.[1]?.trim();
}

// `<https://...|Display Name>` -> { name: "Display Name", url }, or
// `<https://...>` -> { name: undefined, url }, or plain text -> { name: text }.
function parseLinkField({ value }: { value?: string }): { name?: string; url?: string } {
  if (!value) return {};
  const linked = value.match(/^<([^|>]+)\|([^>]*)>$/);
  if (linked) return { url: linked[1], name: linked[2].trim() || undefined };
  const bareLink = value.match(/^<([^>]+)>$/);
  if (bareLink) return { url: bareLink[1] };
  const trimmed = value.trim();
  return trimmed ? { name: trimmed } : {};
}

function parseCurrency({ value }: { value?: string }): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseNumber({ value }: { value?: string }): number | null {
  if (!value) return null;
  const num = Number(value.trim());
  return Number.isFinite(num) ? num : null;
}

function parseCx({ value }: { value?: string }): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function effectiveAcrForDeal({
  amount,
  acr,
  termLengthDays,
}: {
  amount: number | null;
  acr: number | null;
  termLengthDays: number | null;
}): { effectiveAcr: number | null; acrConfidence: AcrConfidence | null } {
  if (acr !== null && acr > 0) return { effectiveAcr: acr, acrConfidence: "explicit" };
  if (amount === null) return { effectiveAcr: null, acrConfidence: null };
  if (termLengthDays && termLengthDays > 0) {
    return { effectiveAcr: amount / (termLengthDays / 365), acrConfidence: "estimated" };
  }
  if (amount > FLAG_THRESHOLD) {
    return { effectiveAcr: amount, acrConfidence: "flagged_review" };
  }
  return { effectiveAcr: amount, acrConfidence: "assumed_annual" };
}

// Returns null if the message isn't an "Opportunity closed won" post.
export function parseClosedWonMessage({ message }: { message: SlackExportMessage }): SalesWinDeal | null {
  const rawText = message.rawText ?? "";
  if (!message.botId || !/closed won/i.test(message.text ?? "")) return null;
  if (!message.timestamp) return null;

  const opportunity = parseLinkField({ value: fieldValue({ rawText, label: "Opportunity" }) });
  const companyField = parseLinkField({
    value: fieldValue({ rawText, label: "Company" }),
  });
  const company = companyField.name ?? companyField.url ?? "Unknown";

  const amount = parseCurrency({ value: fieldValue({ rawText, label: "Amount" }) });
  const acr = parseCurrency({ value: fieldValue({ rawText, label: "ACR" }) });
  const termLengthDays = parseNumber({ value: fieldValue({ rawText, label: "Term Length" }) });

  const date = message.timestamp;
  const { effectiveAcr, acrConfidence } = effectiveAcrForDeal({ amount, acr, termLengthDays });
  return {
    ts: message.ts,
    date,
    year: new Date(date).getUTCFullYear(),
    opportunityName: opportunity.name,
    opportunityUrl: opportunity.url,
    ownerAE: fieldValue({ rawText, label: "Owner (AE)" }) ?? fieldValue({ rawText, label: "Owner" }),
    cx: parseCx({ value: fieldValue({ rawText, label: "CX (TAM, CSM, SA)" }) }),
    company,
    companyKey: company.trim().toLowerCase(),
    companyUrl: companyField.url,
    amount,
    acr,
    termLengthDays,
    opportunityType: fieldValue({ rawText, label: "Opportunity type" }),
    businessUseCase: fieldValue({ rawText, label: "Business Use Case" }) || undefined,
    maxGpuPrice: parseNumber({ value: fieldValue({ rawText, label: "Max GPU Price" }) }),
    effectiveAcr,
    acrConfidence,
  };
}
