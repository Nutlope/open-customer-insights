# Security

Customer Insights handles sensitive customer conversations. Treat every deployment as a private data system even though the source code is public.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not open a public issue containing credentials, customer data, exploit details, or deployment URLs.

## Deployment expectations

- Keep Clerk authentication enabled for the application and MCP endpoint.
- Use a unique, high-entropy `INTERNAL_CONVEX_SECRET` and never expose it to the browser.
- Grant Gong, Pylon, Slack, Clerk, Convex, Together AI, and Exa credentials the minimum scopes needed.
- Never commit `.env` files, exports, transcripts, tickets, database snapshots, or generated customer reports.
- Review provider retention and privacy settings before ingesting production customer data.
- Rotate any credential immediately if it appears in logs, commits, issues, or pull requests.

The repository contains application code only. A deployment's Convex data and third-party credentials are not part of the open-source release.
