export function resolveAppUrl({ configuredUrl }: { configuredUrl?: string }): string {
  const url = configuredUrl?.trim() || "http://localhost:3030";
  return url.replace(/\/+$/, "");
}

export const APP_URL = resolveAppUrl({
  configuredUrl: process.env.NEXT_PUBLIC_APP_URL,
});
export const MCP_API_URL = `${APP_URL}/api/mcp`;
export const APP_NAME = "Together Customer Insights";
export const MCP_SERVER_NAME = "together-customer-insights";
