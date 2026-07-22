# Rules

- **SUPER IMPORTANT: avoid positional function parameters** — when adding or changing functions, prefer a single typed object parameter over positional arguments, especially when there is more than one input. Do not add functions with long positional parameter lists. Use named object properties so call sites are self-documenting and safer to change.
- **No `any`** — use proper TypeScript types everywhere. If a type is unknown, use `unknown` and narrow it.
- **Use `npx convex dev --once` for development validation** — never deploy to a production Convex environment unless the user explicitly asks.
- **Keep non-query/mutation/action logic in `lib/`** — Convex deploys everything inside `convex/`. Pure helpers, type definitions, mappers, and utility functions that are not direct Convex query/mutation/action handlers MUST live in `lib/convex/` (or `lib/`), NOT in `convex/`. Only top-level `export const foo = query/mutation/action(...)` definitions belong in `convex/`.
- **Never run `vercel --prod` or any Vercel deploy command yourself** — do not deploy to Vercel unless the user explicitly asks to deploy. When done with changes, stop and let the user decide when to deploy.
- **Never run the Next.js/dev server yourself** — the user runs the dev server. Assume it is already running when browser or localhost verification is needed; if it is not reachable, tell the user instead of starting it.
- **Never use `npx convex dev --once --typecheck=disable`** — always fix TypeScript errors properly. Circular references in Convex modules must be resolved by using direct `ctx.db` access instead of `api.module.*` cross-references.
- **Use `npx convex query` / `npx convex mutation` to inspect data** — never write ad-hoc Node.js scripts with ConvexHttpClient. The CLI is the correct way. Example: `npx convex query reportsQueries:listReports '{"from":"2026-03-01","to":"2026-05-01","type":"weekly"}'`
- **Do not create Next API proxy routes for Convex-backed UI workflows** — client UI should call Convex queries/mutations/actions directly with the Convex React hooks (`useQuery`, `useMutation`, `useAction`). Only add `app/api/*` routes for real external HTTP surfaces like chat, MCP, webhooks, or third-party callbacks.

# What this app is

Customer-insights workspace that exposes configured call transcripts, support tickets, and Slack conversations as a semantic-search MCP server. Authenticated users can:

- Query customer feedback via a chat UI (AI SDK + Together AI LLM)
- Connect any MCP-compatible agent (Claude, Cursor, etc.) to search calls and tickets

# Stack

- **Next.js** (app router) + **Tailwind CSS v4** + **Clerk** for auth
- **Convex** — database, cron jobs, serverless actions (all backend logic lives here)
- **Together AI** — embeddings (`intfloat/multilingual-e5-large-instruct`) + LLM for chat
- **Gong API** — call transcripts ingested hourly, chunked at 800 chars
- **Pylon API** — optional support-ticket ingestion

# Data pipeline

```
Gong/Pylon API → chunks table (text only)
                      ↓ (30-min cron)
             Together AI embeddings
                      ↓
           chunkEmbeddings table (1024-dim vectors)
```

Ingest and embed are decoupled. Ingest writes raw text via `upsertChunkText`; the embed cron (`convex/crons.ts`) picks up un-embedded chunks every 30 min.

# Key files

| Path | What it does |
|------|-------------|
| `convex/ingest.ts` | Gong + Pylon ingest actions |
| `convex/embed.ts` | `runEmbedPending` — embeds chunks via Together AI |
| `convex/crons.ts` | Scheduled jobs (ingest hourly, embed every 30 min) |
| `convex/search.ts` | Vector search + keyword search queries |
| `convex/chatThreads.ts` | Live web chat threads, agent prompt, and tool wiring |
| `lib/embedding/gong/text.ts` | Chunks Gong transcripts into 800-char pieces |
| `lib/embedding/pylon/text.ts` | Chunks Pylon issue threads into 800-char pieces |
| `app/api/mcp/route.ts` | MCP server endpoint |
| `scripts/backfill.ts` | One-shot historical import: `bun run scripts/backfill.ts gong 365` |
| `scripts/embed.ts` | Manual embed loop with progress bar: `bun run scripts/embed.ts` |
| `embed.md` | Embedding pipeline notes, migration history, chunk sizing rationale |

# Public-repository safety

- Never commit real customer names, domains, conversations, reports, exports, database snapshots, credentials, or deployment origins.
- Use synthetic examples in tests, documentation, screenshots, issues, and pull requests.
- Keep integrations optional: missing provider credentials should make their scheduled jobs no-op safely.
