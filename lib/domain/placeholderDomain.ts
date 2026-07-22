// Domains ending in the RFC 2606 reserved ".invalid" TLD are used as
// placeholders for companies whose real domain isn't known yet (e.g. stealth
// startups). They never resolve, so the UI should hide favicons/website links
// for them rather than pointing at a broken or unrelated site.
export function isPlaceholderDomain({ domain }: { domain?: string }): boolean {
  if (!domain) return false;
  return domain.toLowerCase().endsWith(".invalid");
}
