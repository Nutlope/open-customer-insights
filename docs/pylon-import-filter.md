# Pylon import filtering

The Pylon importer filters low-signal support traffic before storing or embedding it. This keeps search results focused while retaining useful customer conversations.

The default policy excludes:

- Bulk notifications and automated lifecycle messages
- CSAT requests and survey responses
- Delivery failures and bounce notices
- Invoice and payment notifications
- Recruiting messages
- Known vendor spam
- Empty issues

Email issues are not rejected wholesale. The importer keeps substantive email threads after applying the filters above.

For a strict historical import that excludes every email issue, use:

```bash
bun run scripts/pylon-reimport.ts --strict
```

Public documentation and tests must use synthetic examples. Do not add real customer names, titles, counts, message bodies, or operational metrics to this file.
