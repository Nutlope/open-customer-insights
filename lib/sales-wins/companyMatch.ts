// Shared helpers for cross-referencing sales-wins companies (from the
// configured sales-wins Slack export) against companyProfiles records.

export type WinsCompany = {
  company: string;
  companyKey: string;
  dealCount: number;
  lifetimeAmount: number;
  currentAcr: number | null;
  currentAcrConfidence: string | null;
};

export type CompanyProfile = {
  name: string;
  domain: string;
  status: string;
  domainAliases?: string[];
};

const SUFFIX_RE = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|labs|technologies|technology|holdings)\b\.?/g;

export function normalizeName({ value }: { value: string }): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/["“”'`]/g, "")
    .split(/\s+-\s+/)[0]!
    .replace(/[.,]/g, " ")
    .replace(SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function domainRoot({ domain }: { domain: string }): string {
  return domain.toLowerCase().replace(/^www\./, "").split(".")[0]!;
}

export function normalizeDomain({ value }: { value?: string }): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]!;
  return cleaned || null;
}

export function looksLikeValidDomain({ value }: { value: string }): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(value.replace(/^www\./, ""));
}

export function buildCompanyProfileIndex({ profiles }: { profiles: CompanyProfile[] }): {
  byNormalizedName: Map<string, CompanyProfile>;
  byDomainRoot: Map<string, CompanyProfile>;
} {
  const byNormalizedName = new Map<string, CompanyProfile>();
  const byDomainRoot = new Map<string, CompanyProfile>();
  for (const profile of profiles) {
    byNormalizedName.set(normalizeName({ value: profile.name }), profile);
    byDomainRoot.set(domainRoot({ domain: profile.domain }), profile);
    for (const alias of profile.domainAliases ?? []) {
      byDomainRoot.set(domainRoot({ domain: alias }), profile);
    }
  }
  return { byNormalizedName, byDomainRoot };
}

export function findUnmatchedWinsCompanies({
  companies,
  profiles,
}: {
  companies: WinsCompany[];
  profiles: CompanyProfile[];
}): { matched: number; unmatched: WinsCompany[] } {
  const { byNormalizedName, byDomainRoot } = buildCompanyProfileIndex({ profiles });

  const unmatched: WinsCompany[] = [];
  let matched = 0;
  for (const wins of companies) {
    const normalized = normalizeName({ value: wins.company });
    const root = domainRoot({ domain: wins.companyKey });
    if (byNormalizedName.has(normalized) || byDomainRoot.has(root) || byDomainRoot.has(normalized.replace(/\s+/g, ""))) {
      matched++;
      continue;
    }
    unmatched.push(wins);
  }

  return { matched, unmatched };
}
