/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aggregates from "../aggregates.js";
import type * as callMutations from "../callMutations.js";
import type * as chatThreads from "../chatThreads.js";
import type * as chunkMutations from "../chunkMutations.js";
import type * as companies from "../companies.js";
import type * as companyTimeline from "../companyTimeline.js";
import type * as competitors from "../competitors.js";
import type * as crons from "../crons.js";
import type * as embed from "../embed.js";
import type * as enrichment from "../enrichment.js";
import type * as ingest from "../ingest.js";
import type * as prospects from "../prospects.js";
import type * as pylonMutations from "../pylonMutations.js";
import type * as queries from "../queries.js";
import type * as rateLimits from "../rateLimits.js";
import type * as revenue from "../revenue.js";
import type * as salesWins from "../salesWins.js";
import type * as savedQueries from "../savedQueries.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as slack from "../slack.js";
import type * as slackMentions from "../slackMentions.js";
import type * as sourceDetails from "../sourceDetails.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aggregates: typeof aggregates;
  callMutations: typeof callMutations;
  chatThreads: typeof chatThreads;
  chunkMutations: typeof chunkMutations;
  companies: typeof companies;
  companyTimeline: typeof companyTimeline;
  competitors: typeof competitors;
  crons: typeof crons;
  embed: typeof embed;
  enrichment: typeof enrichment;
  ingest: typeof ingest;
  prospects: typeof prospects;
  pylonMutations: typeof pylonMutations;
  queries: typeof queries;
  rateLimits: typeof rateLimits;
  revenue: typeof revenue;
  salesWins: typeof salesWins;
  savedQueries: typeof savedQueries;
  search: typeof search;
  seed: typeof seed;
  slack: typeof slack;
  slackMentions: typeof slackMentions;
  sourceDetails: typeof sourceDetails;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  callsCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"callsCount">;
  issuesCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"issuesCount">;
  chunksStats: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"chunksStats">;
};
