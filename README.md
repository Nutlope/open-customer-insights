![Customer Insights — Every customer signal, one clear answer](./public/cover/og-cover.png)

# Open Customer Insights

Search calls, support tickets, Slack conversations, and company context from one private intelligence layer.

Customer Insights is an open-source, Clerk-authenticated workspace with a web chat, company and competitor views, semantic search powered by Together AI, scheduled Convex ingestion, and an MCP endpoint for compatible agents.

> This repository contains application code and synthetic demo data only. It does not include a hosted deployment, customer data, or credentials.

## What you get

- Grounded chat across call transcripts, support tickets, and Slack
- Semantic and keyword search with source inspection
- Company timelines and customer-status views
- Competitor mention tracking
- An authenticated MCP server for coding agents and assistants
- Optional Gong, Pylon, Slack, and company-enrichment integrations
- A deterministic local seed dataset using reserved `.example` domains

## Architecture

```text
Gong / Pylon / Slack
        |
        | optional Convex ingestion jobs
        v
 conversations + text chunks + company context
        |
        | Together AI embeddings
        v
 Convex hybrid search
        |
        +--> authenticated web chat
        +--> company and competitor views
        +--> authenticated MCP endpoint
```

Each external integration is optional. Jobs without matching credentials skip safely, so you can begin with synthetic data and add only the sources you use.

## Run locally

### Prerequisites

- [Bun](https://bun.sh/)
- A [Convex](https://www.convex.dev/) project
- A [Clerk](https://clerk.com/) application
- A [Together AI](https://www.together.ai/) API key for chat and embeddings

### 1. Install and configure

```bash
bun install
cp .env.example .env.local
```

In Clerk, create a JWT template named `convex`. Add the Clerk keys, Together AI key, and a random `INTERNAL_CONVEX_SECRET` to `.env.local`.

### 2. Start Convex

In the first terminal:

```bash
bun run convex
```

Follow the Convex setup prompts on the first run. The command keeps the local backend running and updates generated types as Convex files change.

For a one-shot schema/function sync instead:

```bash
bun run convex:once
```

### 3. Load synthetic demo data

With Convex running:

```bash
bun run seed
```

The seed is deterministic and idempotent. It creates 12 fictional companies, 36 calls, 48 tickets, 84 searchable chunks, 24 Slack mentions, 24 timeline events, and a multi-vendor competitor leaderboard. It refuses to run over non-demo data unless you explicitly pass `{"force":true}` to the Convex function.

Remove only the synthetic rows with:

```bash
bun run seed:clear
```

### 4. Start the web app

In a second terminal:

```bash
bun run dev
```

Open [http://localhost:3030](http://localhost:3030).

## Configuration

Core variables:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public app origin; keep `http://localhost:3030` locally |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk browser key |
| `CLERK_SECRET_KEY` | Clerk server key |
| `CLERK_JWT_ISSUER_DOMAIN` | Issuer for the Clerk JWT template named `convex` |
| `INTERNAL_CONVEX_SECRET` | High-entropy secret for trusted server-to-Convex calls |
| `TOGETHER_API_KEY` | Together AI key for chat, embeddings, and classification |

Optional integrations:

| Variable | Enables |
| --- | --- |
| `GONG_ACCESS_KEY`, `GONG_ACCESS_KEY_SECRET` | Gong call ingestion |
| `PYLON_API_KEY` | Pylon support-ticket ingestion |
| `SLACK_MCP_XOXB_TOKEN` | Slack search and enrichment |
| `ORGANIZATION_EMAIL_DOMAINS` | Domains used to identify internal participants |
| `EXA_API_KEY` | Company enrichment |
| `SALES_WINS_SLACK_CHANNEL_ID`, `SALES_WINS_INITIAL_TIMESTAMP` | Optional closed-won Slack ingestion |

See [`.env.example`](./.env.example) for the full template.

## Load real data

Scheduled jobs live in `convex/crons.ts`. Historical imports and embedding helpers live in `scripts/`:

```bash
bun run scripts/backfill.ts gong 365
bun run scripts/embed.ts
```

Imports can contain sensitive customer data. Local databases, exports, transcripts, and tickets are ignored by Git and must never be committed.

## MCP server

The authenticated MCP endpoint is:

```text
https://your-deployment.example/api/mcp
```

It uses Clerk OAuth and exposes tools for hybrid search, full source retrieval, company discovery, and configured Slack context. The signed-in web app shows connection details for supported clients.

## Commands

```bash
bun run dev          # Next.js on port 3030
bun run convex       # Keep the Convex dev backend running
bun run convex:once  # Sync Convex once and exit
bun run seed         # Add synthetic demo data
bun run seed:clear   # Remove synthetic demo data
bun run test         # Unit tests
bun run typecheck    # TypeScript checks
bun run build        # Production build
```

The cover image is reproducible from [`public/cover/preview.html`](./public/cover/preview.html).
