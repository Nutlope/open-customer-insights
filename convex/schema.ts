import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Gong call metadata + summaries
  calls: defineTable({
    gongId: v.string(),
    title: v.string(),
    started: v.string(),
    duration: v.number(),
    parties: v.array(
      v.object({
        name: v.string(),
        emailAddress: v.optional(v.string()),
      })
    ),
    companyDomain: v.optional(v.string()),
    brief: v.optional(v.string()),
    keyPoints: v.optional(v.array(v.string())),
    topics: v.optional(v.array(v.object({ name: v.string(), duration: v.number() }))),
    ingestedAt: v.string(),
  })
    .index("by_gong_id", ["gongId"])
    .index("by_started", ["started"])
    .index("by_company_started", ["companyDomain", "started"]),

  // Pylon support issue metadata
  pylonIssues: defineTable({
    pylonId: v.string(),
    number: v.number(),
    title: v.string(),
    state: v.string(),
    source: v.string(),
    tags: v.array(v.string()),
    accountId: v.optional(v.string()),
    companyName: v.optional(v.string()),
    companyDomain: v.optional(v.string()),
    issueCategory: v.optional(v.string()),
    priority: v.optional(v.string()),
    type: v.optional(v.string()),
    requesterId: v.optional(v.string()),
    requesterEmail: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    assigneeEmail: v.optional(v.string()),
    teamId: v.optional(v.string()),
    link: v.optional(v.string()),
    latestMessageTime: v.optional(v.string()),
    firstResponseTime: v.optional(v.string()),
    resolutionTime: v.optional(v.string()),
    customerPortalVisible: v.optional(v.boolean()),
    createdAt: v.string(),
    updatedAt: v.string(),
    ingestedAt: v.string(),
  })
    .index("by_pylon_id", ["pylonId"])
    .index("by_created", ["createdAt"])
    .index("by_company_created", ["companyDomain", "createdAt"]),

  // Separate table for embeddings — avoids loading large float64 arrays on metadata queries
  chunkEmbeddings: defineTable({
    embedding: v.array(v.float64()),
    dataSource: v.string(), // "gong" | "pylon"
  }).vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1024, // intfloat/multilingual-e5-large-instruct via Together AI
    filterFields: ["dataSource"],
  }),

  // Unified text chunks for both sources
  chunks: defineTable({
    dataSource: v.string(), // "gong" | "pylon"
    sourceId: v.string(),   // gongCallId or pylonIssueId
    chunkId: v.string(),
    text: v.string(),
    companyDomain: v.optional(v.string()), // stored here for fast post-search company filtering
    ingestedAt: v.optional(v.string()),    // ISO timestamp of the ingest run that wrote this chunk
    // Gong-specific
    startSec: v.optional(v.number()),
    endSec: v.optional(v.number()),
    speakers: v.optional(v.array(v.string())),
    // Gong speaker-affiliation buckets. Distinct participant names per chunk.
    // `internalSpeakers` = Gong affiliation "Internal" (Together reps),
    // `externalSpeakers` = "External" (customers). "Unknown" lands in neither.
    // Optional + Gong-specific: pre-backfill chunks and all pylon chunks omit
    // them, and search treats absent arrays as [] (unlabeled, never internal).
    internalSpeakers: v.optional(v.array(v.string())),
    externalSpeakers: v.optional(v.array(v.string())),
    // Pylon-specific
    authors: v.optional(v.array(v.string())),
    embeddingId: v.optional(v.id("chunkEmbeddings")),
    needsEmbedding: v.optional(v.literal(true)),
    competitorMentions: v.optional(v.array(v.string())),
  })
    .index("by_source", ["dataSource", "sourceId"])
    .index("by_source_chunk", ["dataSource", "sourceId", "chunkId"])
    .index("by_source_ingested", ["dataSource", "sourceId", "ingestedAt"])
    .index("by_embedding", ["embeddingId"])
    .index("by_needs_embedding", ["needsEmbedding"])
    .searchIndex("by_text", {
      searchField: "text",
      filterFields: ["dataSource"],
    }),

  competitorLeaderboardCache: defineTable({
    range: v.string(), // "week" | "month" | "year"
    rows: v.array(v.object({
      name: v.string(),
      domain: v.string(),
      calls: v.number(),
      tickets: v.number(),
      total: v.number(),
      lastSeen: v.union(v.string(), v.null()),
    })),
    computedAt: v.number(),
  }).index("by_range", ["range"]),

  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"]),

  apiKeyUsage: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    tokensUsed: v.optional(v.number()),
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_time", ["userId", "timestamp"]),

  userQueries: defineTable({
    userId: v.id("users"),
    channel: v.union(v.literal("chat"), v.literal("mcp"), v.literal("slack")),
    query: v.string(),
    threadId: v.optional(v.string()),
    source: v.optional(v.string()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    limit: v.optional(v.number()),
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_time", ["userId", "timestamp"]),

  savedQueries: defineTable({
    userId: v.id("users"),
    title: v.string(),
    query: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastRunAt: v.optional(v.number()),
    runCount: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_user_query", ["userId", "query"]),

  savedQueryRuns: defineTable({
    userId: v.id("users"),
    savedQueryId: v.id("savedQueries"),
    title: v.string(),
    query: v.string(),
    threadId: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_user_time", ["userId", "timestamp"])
    .index("by_saved_query_time", ["savedQueryId", "timestamp"]),

  chatToolCalls: defineTable({
    threadId: v.string(),
    messageId: v.string(),
    order: v.number(),
    toolCallId: v.string(),
    toolName: v.string(),
    inputJson: v.optional(v.string()),
    outputPreview: v.optional(v.string()),
    isError: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_message", ["messageId"]),

  slackChannelCache: defineTable({
    channelId: v.string(),
    name: v.optional(v.string()),
    isPrivate: v.optional(v.boolean()),
    memberCount: v.optional(v.number()),
    isJoined: v.boolean(),
    refreshedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_joined", ["isJoined"])
    .index("by_refreshed", ["refreshedAt"]),

  slackUserCache: defineTable({
    userId: v.string(),
    username: v.string(),
    email: v.optional(v.string()),
    realName: v.optional(v.string()),
    displayName: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isBot: v.optional(v.boolean()),
    deleted: v.optional(v.boolean()),
    isRestricted: v.optional(v.boolean()),
    isUltraRestricted: v.optional(v.boolean()),
    isStranger: v.optional(v.boolean()),
    refreshedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_refreshed", ["refreshedAt"]),

  // Tracks the last successful full refresh of the Slack channel cache,
  // independent of how many channels are joined, so an empty joined set does
  // not look perpetually stale and trigger a Slack fetch on every call.
  slackCacheMeta: defineTable({
    key: v.string(),
    refreshedAt: v.number(),
  })
    .index("by_key", ["key"]),

  reports: defineTable({
    type: v.literal("daily"),
    periodStart: v.string(),   // ISO date
    periodEnd: v.string(),     // ISO date
    callCount: v.number(),
    ticketCount: v.number(),
    summary: v.string(),       // LLM-generated markdown
    sentiment: v.object({
      positive: v.float64(),
      negative: v.float64(),
      neutral: v.float64(),
    }),
    highlights: v.array(
      v.object({
        title: v.string(),
        description: v.string(),
        company: v.optional(v.string()),
        companyDomain: v.optional(v.string()),
        sourceRefs: v.optional(v.array(v.object({
          source: v.union(v.literal("call"), v.literal("support")),
          id: v.string(),
          title: v.optional(v.string()),
        }))),
        sentiment: v.union(v.literal("positive"), v.literal("negative"), v.literal("neutral")),
      })
    ),
    generatedAt: v.number(),
  })
    .index("by_type_period", ["type", "periodStart"])
    .index("by_generated", ["generatedAt"]),

  dailyInsights: defineTable({
    reportId: v.id("reports"),
    highlightKey: v.string(),
    periodStart: v.string(),
    periodEnd: v.string(),
    title: v.string(),
    description: v.string(),
    company: v.optional(v.string()),
    companyDomain: v.optional(v.string()),
    sourceRefs: v.optional(v.array(v.object({
      source: v.union(v.literal("call"), v.literal("support")),
      id: v.string(),
      title: v.optional(v.string()),
    }))),
    sentiment: v.union(v.literal("positive"), v.literal("negative"), v.literal("neutral")),
    status: v.union(v.literal("review"), v.literal("posted"), v.literal("dismissed")),
    generatedAt: v.number(),
    updatedAt: v.number(),
    updatedByEmail: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    dismissedAt: v.optional(v.number()),
    dismissReason: v.optional(v.string()),
    slackChannel: v.optional(v.string()),
    slackMessageTs: v.optional(v.string()),
  })
    .index("by_report", ["reportId"])
    .index("by_period", ["periodStart"])
    .index("by_status", ["status"])
    .index("by_generated", ["generatedAt"])
    .index("by_report_highlight", ["reportId", "highlightKey"]),

  companyProfiles: defineTable({
    domain: v.string(),
    name: v.string(),
    status: v.union(
      v.literal("customer"),
      v.literal("prospect"),
      v.literal("former_customer"),
      v.literal("unknown"),
    ),
    sources: v.array(v.union(
      v.literal("gong"),
      v.literal("pylon"),
      v.literal("web"),
      v.literal("slack"),
      v.literal("clay"),
    )),
    description: v.optional(v.string()),
    website: v.optional(v.string()),
    domainAliases: v.optional(v.array(v.string())),
    // deprecated — kept for backwards compat with existing docs, not used in new code
    industry: v.optional(v.string()),
    size: v.optional(v.string()),
    headquarters: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    enrichedAt: v.optional(v.number()),
    // Clay fields
    salesforceId: v.optional(v.string()),
    acr: v.optional(v.number()),
    isPotentialCustomer: v.optional(v.boolean()),
    // Timestamp (ms) of the most recent call or ticket for this company (or any of its domain aliases).
    lastActivityAt: v.optional(v.number()),
    // Precomputed sum of companyRevenueDeals.amount across this company's domain
    // and its domain aliases. Kept up to date by incrementCompanyLifetimeRevenue
    // whenever new deals are inserted; backfilled for existing companies via
    // backfillLifetimeRevenue.
    lifetimeRevenue: v.optional(v.number()),
    // Distinct companyRevenueDeals.category values seen across this company's
    // domain and its domain aliases. Kept up to date by
    // addCompanyRevenueCategory whenever new deals are inserted; backfilled
    // for existing companies via backfillLifetimeRevenue.
    revenueCategories: v.optional(v.array(v.union(
      v.literal("inference"),
      v.literal("gpu_cluster"),
      v.literal("credits_other"),
    ))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_domain", ["domain"])
    .index("by_status", ["status"])
    .index("by_acr", ["acr"])
    .index("by_lifetime_revenue", ["lifetimeRevenue"])
    .index("by_company_name", ["name"])
    .index("by_last_activity", ["lastActivityAt"])
    .searchIndex("by_name", {
      searchField: "name",
      filterFields: ["status"],
    }),

  // Fast reverse-lookup: any alias domain → canonical primaryDomain
  domainAliasIndex: defineTable({
    alias: v.string(),
    primaryDomain: v.string(),
  })
    .index("by_alias", ["alias"])
    .index("by_primary", ["primaryDomain"]),

  // ACR-update suggestions surfaced from the sales-wins ACR backfill that need
  // manual review before being applied to companyProfiles.acr (e.g. amounts
  // that look like multi-year contract totals or near-zero placeholders).
  acrSuggestions: defineTable({
    domain: v.string(),
    name: v.string(),
    currentAcr: v.optional(v.number()),
    proposedAcr: v.number(),
    reason: v.union(v.literal("flagged_review"), v.literal("near_zero")),
    confidence: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    detectedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedByEmail: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_domain", ["domain"]),

  // Per-deal revenue records imported from a configured sales-wins
  // Slack export, used to power per-company revenue timelines/charts.
  companyRevenueDeals: defineTable({
    domain: v.string(),
    date: v.string(),
    month: v.string(), // "YYYY-MM"
    year: v.number(),
    amount: v.number(),
    opportunityName: v.string(),
    opportunityType: v.union(v.literal("Net New"), v.literal("Expansion"), v.literal("Renewal")),
    category: v.union(v.literal("inference"), v.literal("gpu_cluster"), v.literal("credits_other")),
    label: v.string(),
    acrConfidence: v.optional(v.string()),
    source: v.literal("slack"),
    createdAt: v.number(),
  })
    .index("by_domain", ["domain"])
    .index("by_domain_month", ["domain", "month"])
    .index("by_year", ["year"]),

  companySegments: defineTable({
    slug: v.string(),
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("archived")),
    audience: v.union(v.literal("prospects"), v.literal("customers"), v.literal("both")),
    detectionPrompt: v.string(),
    searchQueries: v.array(v.string()),
    positiveSignals: v.array(v.string()),
    negativeSignals: v.array(v.string()),
    refreshCadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("manual")),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByEmail: v.optional(v.string()),
    updatedByEmail: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  companySegmentMemberships: defineTable({
    companyId: v.id("companyProfiles"),
    segmentId: v.id("companySegments"),
    fitScore: v.number(),
    confidence: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    stage: v.string(),
    summary: v.string(),
    currentState: v.optional(v.string()),
    scale: v.optional(v.string()),
    extraDetails: v.optional(v.array(v.string())),
    blockers: v.array(v.string()),
    nextSteps: v.array(v.string()),
    evidenceRefs: v.array(v.object({
      source: v.union(v.literal("call"), v.literal("support"), v.literal("slack")),
      id: v.string(),
      title: v.optional(v.string()),
      date: v.optional(v.string()),
      snippet: v.string(),
    })),
    manualEvidenceRefs: v.optional(v.array(v.object({
      source: v.union(v.literal("call"), v.literal("support"), v.literal("slack")),
      id: v.string(),
      title: v.optional(v.string()),
      date: v.optional(v.string()),
      snippet: v.string(),
      // Slack-specific fields — only present when source === "slack".
      // Stored alongside the ref so pinned Slack mentions can be rendered
      // (SlackMentionCard needs channelName, authorName, avatar, etc.).
      slack: v.optional(v.object({
        channelId: v.string(),
        channelName: v.optional(v.string()),
        messageTs: v.string(),
        threadTs: v.optional(v.string()),
        authorName: v.optional(v.string()),
        authorAvatar: v.optional(v.string()),
      })),
      addedByEmail: v.optional(v.string()),
      addedAt: v.number(),
    }))),
    origin: v.optional(v.union(v.literal("ai"), v.literal("manual"))),
    addedByEmail: v.optional(v.string()),
    addedAt: v.optional(v.number()),
    // Deal outcome tracking: whether this prospect is still active, lost to a
    // competitor, won, or stalled. Defaults to "active" when unset.
    outcome: v.optional(v.union(
      v.literal("active"),
      v.literal("lost"),
      v.literal("won"),
      v.literal("stalled"),
    )),
    lostToCompetitor: v.optional(v.string()),
    lostReason: v.optional(v.string()),
    // Competitors named as actively being evaluated alongside Together, even
    // if no decision has been made yet (e.g. Prosus comparing Together vs Nebius).
    competitorsConsidered: v.optional(v.array(v.string())),
    // Whether the outcome fields above were last set by the AI classifier or
    // pinned manually by an admin. Once "manual", refreshes preserve them.
    outcomeOrigin: v.optional(v.union(v.literal("ai"), v.literal("manual"))),
    outcomeSetByEmail: v.optional(v.string()),
    outcomeSetAt: v.optional(v.number()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_segment", ["segmentId"])
    .index("by_segment_company", ["segmentId", "companyId"])
    .index("by_last_seen", ["lastSeenAt"]),

  dismissedCompanySegments: defineTable({
    segmentId: v.id("companySegments"),
    companyId: v.id("companyProfiles"),
    domain: v.string(),
    dismissedByEmail: v.optional(v.string()),
    dismissedAt: v.number(),
    reason: v.optional(v.string()),
  })
    .index("by_segment", ["segmentId"])
    .index("by_segment_company", ["segmentId", "companyId"])
    .index("by_segment_domain", ["segmentId", "domain"]),

  // Per-company timeline: AI weekly reflections and user-added manual notes.
  // Calls, tickets, and Slack mentions are stored in their own tables and merged
  // in the UI; this table only holds generated/manual events.
  companyTimeline: defineTable({
    companyId: v.id("companyProfiles"),
    type: v.union(v.literal("ai_reflection"), v.literal("manual_note")),
    date: v.number(), // ms timestamp — the date this event represents (backdatable for notes)
    content: v.string(),
    // ai_reflection only
    riskScore: v.optional(v.number()), // 0-100
    riskReason: v.optional(v.string()),
    weekStart: v.optional(v.string()), // "YYYY-MM-DD" — the Monday of the reflected week
    detectedCompetitors: v.optional(v.array(v.string())),
    // manual_note only
    authorEmail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_company_date", ["companyId", "date"])
    .index("by_type_date", ["type", "date"]),

  // Slack messages from joined channels that mention a watchlisted company
  // (see convex/slackMentions.ts listSlackWatchlistCompaniesInternal), found
  // by the daily mention-scan cron.
  slackCompanyMentions: defineTable({
    companyId: v.id("companyProfiles"),
    domain: v.string(),
    channelId: v.string(),
    channelName: v.optional(v.string()),
    messageTs: v.string(),
    threadTs: v.string(),
    text: v.string(),
    matchedTerms: v.array(v.string()),
    authorName: v.optional(v.string()),
    authorUserId: v.optional(v.string()),
    postedAt: v.string(), // ISO timestamp derived from messageTs
    createdAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_company_posted", ["companyId", "postedAt"])
    .index("by_channel_message", ["channelId", "messageTs"]),

  // Tracks the Slack `ts` cursor of the most recent message scanned per
  // channel, so the daily mention-scan cron only fetches new history each run.
  slackChannelScanState: defineTable({
    channelId: v.string(),
    lastScannedTs: v.string(),
    updatedAt: v.number(),
  })
    .index("by_channel", ["channelId"]),

  companySegmentRuns: defineTable({
    segmentId: v.id("companySegments"),
    summary: v.string(),
    newCompanies: v.number(),
    updatedCompanies: v.number(),
    evidenceCount: v.number(),
    startedAt: v.number(),
    completedAt: v.number(),
  })
    .index("by_segment", ["segmentId"])
    .index("by_completed", ["completedAt"]),

  // Tracks the Slack `ts` cursor of the most recent message scanned in the
  // configured sales-wins channel, so the daily sales-wins import cron
  // (convex/salesWins.ts) only fetches new history each run.
  salesWinsScanState: defineTable({
    channelId: v.string(),
    lastScannedTs: v.string(),
    updatedAt: v.number(),
  })
    .index("by_channel", ["channelId"]),

  // Closed-won deals found by the sales-wins import cron whose company name
  // didn't match an existing companyProfiles record and had no usable domain
  // in the Slack message itself, so a domain couldn't be confidently
  // resolved automatically. suggestedDomain is an LLM guess shown as a hint
  // for the reviewer in app/admin/pending-revenue-deals — never applied
  // without manual approval (see convex/salesWins.ts).
  pendingRevenueDeals: defineTable({
    channelId: v.string(),
    messageTs: v.string(),
    companyName: v.string(),
    companyKey: v.string(),
    suggestedDomain: v.optional(v.string()),
    date: v.string(),
    month: v.string(),
    year: v.number(),
    amount: v.number(),
    opportunityName: v.string(),
    opportunityType: v.union(v.literal("Net New"), v.literal("Expansion"), v.literal("Renewal")),
    category: v.union(v.literal("inference"), v.literal("gpu_cluster"), v.literal("credits_other")),
    label: v.string(),
    acrConfidence: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedByEmail: v.optional(v.string()),
    resolvedDomain: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_message", ["channelId", "messageTs"]),

});
