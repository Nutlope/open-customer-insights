# Customer Insights

An open-source workspace for searching and summarizing customer conversations from calls, support tickets, and Slack. It includes a Clerk-authenticated web app, scheduled Convex ingestion jobs, semantic search powered by Together AI, and an MCP endpoint for compatible agents.

This repository contains application code only. It does not include a hosted deployment, customer data, or credentials.

## Project origin

This open-source edition is maintained separately from the private operational deployment. It starts from a clean Git history so internal data, deployment details, and operational history never become part of the public repository.

## Architecture

```text
Gong / Pylon / Slack
        |
        | optional Convex ingestion jobs
        v
 conversations and text chunks
        |
        | Together AI embeddings
        v
 Convex vector search
        |
        +--> authenticated web app
        +--> authenticated MCP endpoint
        +--> generated reports
```

Each integration is optional. Scheduled jobs without the corresponding credentials safely skip their work, so you can start with only the data sources you use.

## Prerequisites

- [Bun](https://bun.sh/)
- A [Convex](https://www.convex.dev/) project
- A [Clerk](https://clerk.com/) application
- A [Together AI](https://www.together.ai/) API key
- Credentials for any optional data sources you enable

## Local setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Copy the example environment file:

   ```bash
   cp .env.example .env.local
   ```

3. Start Convex and follow its setup prompts:

   ```bash
   bun run convex
   ```

4. In Clerk, create a JWT template named `convex`, then fill in the Clerk and Convex values in `.env.local`.

5. Keep `NEXT_PUBLIC_APP_URL=http://localhost:3030` locally. Set it to your own origin in the hosting platform for a deployed instance.

6. Start the Next.js app:

   ```bash
   bun run dev
   ```

The local app runs at `http://localhost:3030`.

## Configuration

Core configuration:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Your app's public origin; used to generate MCP and OAuth URLs |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk browser key |
| `CLERK_SECRET_KEY` | Clerk server key |
| `CLERK_JWT_ISSUER_DOMAIN` | Issuer for the Clerk JWT template named `convex` |
| `INTERNAL_CONVEX_SECRET` | Random secret for trusted server-to-Convex calls |
| `ADMIN_EMAILS` | Comma-separated administrator email addresses |
| `TOGETHER_API_KEY` | Together AI key for chat, embeddings, reports, and classifications |

Optional integrations:

| Variable | Enables |
| --- | --- |
| `GONG_ACCESS_KEY`, `GONG_ACCESS_KEY_SECRET` | Gong call ingestion |
| `PYLON_API_KEY` | Pylon support-ticket ingestion |
| `SLACK_MCP_XOXB_TOKEN` | Slack search and enrichment |
| `ORGANIZATION_EMAIL_DOMAINS` | Comma-separated domains used to identify internal Slack participants |
| `EXA_API_KEY` | Company enrichment |
| `SALES_WINS_SLACK_CHANNEL_ID`, `SALES_WINS_INITIAL_TIMESTAMP` | Closed-won Slack ingestion from a chosen channel and starting message timestamp |

See [`.env.example`](.env.example) for the complete template.

## Loading data

Scheduled jobs live in `convex/crons.ts`. They ingest configured sources and separately embed pending chunks. Historical import helpers are available in `scripts/`:

```bash
bun run scripts/backfill.ts gong 365
bun run scripts/embed.ts
```

Imports can contain sensitive customer data. Local databases, exports, transcripts, and generated reports are intentionally ignored by Git and must never be committed.

## MCP server

The remote MCP endpoint is available at:

```text
https://your-deployment.example/api/mcp
```

It uses Clerk OAuth and exposes tools for searching conversations, retrieving source records, and reading generated reports. The authenticated app shows connection details for supported clients.

## Commands

```bash
bun run dev        # Next.js on port 3030
bun run convex     # Convex development deployment
bun run test       # Unit tests
bun run typecheck  # TypeScript checks
bun run build      # Production build
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities according to [SECURITY.md](SECURITY.md), and use only synthetic data in public issues, tests, screenshots, and examples.
