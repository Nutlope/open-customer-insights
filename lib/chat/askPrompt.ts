import { isPlaceholderDomain } from "@/lib/domain/placeholderDomain";

export function companyAskPromptHref({ name, domain }: { name: string; domain: string }): string {
  const text = isPlaceholderDomain({ domain })
    ? `Tell me more about ${name}`
    : `Tell me more about ${name} (${domain})`;
  return `/?prompt=${encodeURIComponent(text)}`;
}
