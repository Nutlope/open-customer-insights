import { z } from "zod";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { capToolOutput, type ToolOutputOptions } from "./output";

export const LIST_COMPANIES_TOOL_DESCRIPTION = `Look up companies tracked in our CRM.

Use this to answer questions like:
- "Is Alibaba a customer?"
- "What companies do we have from fintech?"
- "List all customers with ACR"
- "Does Together work with [company name]?"

Returns: company name, primary domain, alias domains, status (customer/prospect/unknown), ACR, call count, ticket count.

Filters:
- search: name or domain substring (e.g. "alibaba", "openai.com")
- status: "customer" | "prospect" | "former_customer" | "unknown"
- limit: max results (default 20)

If a company appears under multiple domains (e.g. alibaba.com + alibaba-inc.com), they are merged under one entry with aliases listed.`;

export const listCompaniesInputSchema = z.object({
  search: z.string().optional().describe("Company name or domain substring to search for"),
  status: z
    .enum(["customer", "prospect", "former_customer", "unknown"])
    .optional()
    .describe("Filter by relationship status"),
  limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)"),
});

export async function listCompaniesTool({
  convex,
  serverSecret,
  search,
  status,
  limit = 20,
  outputOptions,
}: {
  convex: ConvexHttpClient;
  serverSecret?: string;
  search?: string;
  status?: "customer" | "prospect" | "former_customer" | "unknown";
  limit?: number;
  outputOptions?: ToolOutputOptions;
}): Promise<string> {
  const companies = await convex.query(api.companies.listCompanies, {
    serverSecret,
    search,
    status,
    limit,
  });

  if (companies.length === 0) {
    const qualifier = search ? ` matching "${search}"` : "";
    return `No companies found${qualifier}.`;
  }

  const lines = companies.map((c) => {
    const acr = c.acr && c.acr > 0
      ? ` | ACR: $${c.acr >= 1_000_000 ? `${(c.acr / 1_000_000).toFixed(1)}M` : c.acr >= 1_000 ? `${(c.acr / 1_000).toFixed(0)}K` : c.acr}`
      : "";
    const aliases = c.domainAliases && c.domainAliases.length > 0
      ? ` | aliases: ${c.domainAliases.join(", ")}`
      : "";
    return `- ${c.name} (${c.domain}) | ${c.status}${acr}${aliases}`;
  });

  const header = search
    ? `Companies matching "${search}" (${companies.length} result${companies.length === 1 ? "" : "s"}):`
    : `Companies (${companies.length} shown${companies.length === limit ? ", use search to narrow down" : ""}):`;

  return capToolOutput({
    text: `${header}\n${lines.join("\n")}`,
    label: "Company list",
    guidance: "Use a search or status filter, or a smaller limit.",
    outputOptions,
  });
}
