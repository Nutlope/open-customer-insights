# Contributing

Thank you for improving Customer Insights.

## Development

1. Fork and clone the repository.
2. Copy `.env.example` to `.env.local` and configure the services you intend to use.
3. Run `bun install`.
4. Run `bun run convex` in one terminal and `bun run dev` in another.
5. Before opening a pull request, run:

```bash
bun run test
bun run typecheck
bun run build
```

## Data safety

Never include real customer names, domains, transcripts, support tickets, Slack messages, revenue data, credentials, deployment URLs, or exported databases in an issue, fixture, screenshot, commit, or pull request. Use synthetic examples.

## Code style

- Prefer one typed object parameter over positional arguments.
- Do not use `any`; narrow `unknown` values.
- Keep reusable logic outside `convex/`; only Convex handlers belong there.
- Add focused tests for security boundaries and reusable logic.
