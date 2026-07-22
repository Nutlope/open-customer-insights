import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  pylonApi: { kind: "token bucket", rate: 6, period: MINUTE, capacity: 2 },
  gongApi: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 5 },
  auth: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 3 },
  chatPerUser: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 5 },
});