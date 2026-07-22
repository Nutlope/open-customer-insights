import { defineApp, type ComponentDefinition } from "convex/server";
import agent from "@convex-dev/agent/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";

type ComponentConfig = ComponentDefinition<Record<string, never>>;

const rateLimiterComponent = rateLimiter as unknown as ComponentConfig;
const aggregateComponent = aggregate as unknown as ComponentConfig;

const app = defineApp();
app.use(agent, { name: "agent" });
app.use(rateLimiterComponent);
app.use(aggregateComponent, { name: "callsCount" });
app.use(aggregateComponent, { name: "issuesCount" });
app.use(aggregateComponent, { name: "chunksStats" });

export default app;
