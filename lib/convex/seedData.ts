export const DEMO_PREFIX = "demo-";

type CompanyStatus = "customer" | "prospect" | "former_customer" | "unknown";
type CompanySeed = {
  domain: string;
  name: string;
  status: CompanyStatus;
  description: string;
  acr?: number;
  lifetimeRevenue?: number;
};
type CallSeed = {
  gongId: string;
  companyDomain: string;
  title: string;
  started: string;
  duration: number;
  parties: Array<{ name: string; emailAddress?: string }>;
  brief: string;
  keyPoints: string[];
  transcript: string;
};
type TicketSeed = {
  pylonId: string;
  number: number;
  companyName: string;
  companyDomain: string;
  title: string;
  state: string;
  priority: string;
  createdAt: string;
  requesterEmail: string;
  conversation: string;
};

export type DemoSeedData = {
  companies: CompanySeed[];
  calls: CallSeed[];
  tickets: TicketSeed[];
};

function isoDaysAgo({ now, days, hour = 14 }: { now: number; days: number; hour?: number }): string {
  const date = new Date(now - days * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

export function buildDemoSeedData({ now }: { now: number }): DemoSeedData {
  const companies: CompanySeed[] = [
    {
      domain: "northstar.example",
      name: "Northstar Labs",
      status: "customer",
      description: "An AI research platform scaling production inference for multimodal assistants.",
      acr: 180_000,
      lifetimeRevenue: 310_000,
    },
    {
      domain: "brightwave.example",
      name: "Brightwave Health",
      status: "customer",
      description: "A healthcare operations company using language models to summarize clinical workflows.",
      acr: 96_000,
      lifetimeRevenue: 142_000,
    },
    {
      domain: "acme-robotics.example",
      name: "Acme Robotics",
      status: "prospect",
      description: "A robotics startup evaluating low-latency vision model inference at the edge.",
    },
    {
      domain: "meridian.example",
      name: "Meridian Finance",
      status: "former_customer",
      description: "A financial analytics company that previously ran document extraction workloads.",
      lifetimeRevenue: 64_000,
    },
    {
      domain: "luma-commerce.example",
      name: "Luma Commerce",
      status: "unknown",
      description: "A commerce platform exploring faster catalog enrichment and support automation.",
    },
  ];

  const calls: CallSeed[] = [
    {
      gongId: `${DEMO_PREFIX}gong-northstar-01`,
      companyDomain: "northstar.example",
      title: "Northstar production inference review",
      started: isoDaysAgo({ now, days: 1 }),
      duration: 2_340,
      parties: [{ name: "Maya Chen", emailAddress: "maya@northstar.example" }, { name: "Alex Rivera", emailAddress: "alex@example.com" }],
      brief: "Northstar is ready to expand traffic after strong latency results, but wants clearer spend alerts before launch.",
      keyPoints: ["P95 latency improved by 28%", "Expansion depends on budget alerts", "Team prefers the current API compatibility"],
      transcript: "Maya Chen: The latency is finally where we need it. We are seeing about twenty eight percent better p95 than our previous setup. Alex Rivera: Great. What would block the traffic expansion? Maya Chen: We need budget alerts by project and a cleaner way to export usage before we move the remaining workloads.",
    },
    {
      gongId: `${DEMO_PREFIX}gong-brightwave-01`,
      companyDomain: "brightwave.example",
      title: "Brightwave clinical summarization check-in",
      started: isoDaysAgo({ now, days: 3 }),
      duration: 1_860,
      parties: [{ name: "Sam Patel", emailAddress: "sam@brightwave.example" }, { name: "Jordan Lee", emailAddress: "jordan@example.com" }],
      brief: "Brightwave likes output quality and needs a documented data-retention control for compliance review.",
      keyPoints: ["Summary quality is strong", "Compliance review needs retention documentation", "Pilot volume will double next month"],
      transcript: "Sam Patel: The summaries are much more consistent now and our nurses spend less time correcting them. Jordan Lee: Is anything holding up the next phase? Sam Patel: Security needs the retention controls documented. If that passes, we expect to double pilot volume next month.",
    },
    {
      gongId: `${DEMO_PREFIX}gong-acme-01`,
      companyDomain: "acme-robotics.example",
      title: "Acme Robotics technical evaluation",
      started: isoDaysAgo({ now, days: 5 }),
      duration: 2_760,
      parties: [{ name: "Iris Okafor", emailAddress: "iris@acme-robotics.example" }, { name: "Taylor Kim", emailAddress: "taylor@example.com" }],
      brief: "Acme is comparing Together, Fireworks, and Groq for a vision inference workload with strict cold-start requirements.",
      keyPoints: ["Cold starts must stay below 500 ms", "Batching control matters", "Decision expected this quarter"],
      transcript: "Iris Okafor: We are comparing Together with Fireworks and Groq. Cold start is the main technical risk because the robot cannot wait. Taylor Kim: What threshold do you need? Iris Okafor: Under five hundred milliseconds, plus explicit batching controls for burst traffic.",
    },
    {
      gongId: `${DEMO_PREFIX}gong-meridian-01`,
      companyDomain: "meridian.example",
      title: "Meridian renewal retrospective",
      started: isoDaysAgo({ now, days: 8 }),
      duration: 1_440,
      parties: [{ name: "Noah Williams", emailAddress: "noah@meridian.example" }, { name: "Morgan Cruz", emailAddress: "morgan@example.com" }],
      brief: "Meridian moved the workload to AWS after repeated queue delays during end-of-month spikes.",
      keyPoints: ["Queue delays drove churn", "AWS consolidation influenced the decision", "Team may revisit specialized inference"],
      transcript: "Noah Williams: The end of month queue delays were too risky for our extraction jobs, and procurement wanted us consolidated on AWS. Morgan Cruz: Would you reconsider later? Noah Williams: Yes, if burst capacity becomes predictable and the price difference is meaningful.",
    },
    {
      gongId: `${DEMO_PREFIX}gong-luma-01`,
      companyDomain: "luma-commerce.example",
      title: "Luma Commerce discovery",
      started: isoDaysAgo({ now, days: 12 }),
      duration: 1_980,
      parties: [{ name: "Eva Rossi", emailAddress: "eva@luma-commerce.example" }, { name: "Casey Park", emailAddress: "casey@example.com" }],
      brief: "Luma is exploring catalog enrichment and support automation with an initial focus on predictable cost.",
      keyPoints: ["Catalog enrichment is the first workload", "Cost predictability matters more than peak speed", "Support automation may follow"],
      transcript: "Eva Rossi: We want to enrich about two million catalog items, then reuse the platform for support. Casey Park: What matters most in the first phase? Eva Rossi: Predictable cost and straightforward batch jobs. Peak token speed is less important.",
    },
  ];

  const tickets: TicketSeed[] = [
    {
      pylonId: `${DEMO_PREFIX}pylon-northstar-01`, number: 1001, companyName: "Northstar Labs", companyDomain: "northstar.example",
      title: "Usage export missing project labels", state: "open", priority: "high", createdAt: isoDaysAgo({ now, days: 2, hour: 9 }), requesterEmail: "maya@northstar.example",
      conversation: "Maya Chen: The CSV usage export does not include project labels, so our finance team cannot allocate spend. Support: We reproduced this and linked the request to the usage export roadmap.",
    },
    {
      pylonId: `${DEMO_PREFIX}pylon-brightwave-01`, number: 1002, companyName: "Brightwave Health", companyDomain: "brightwave.example",
      title: "Clarify zero-retention configuration", state: "closed", priority: "medium", createdAt: isoDaysAgo({ now, days: 4, hour: 11 }), requesterEmail: "sam@brightwave.example",
      conversation: "Sam Patel: Can you confirm which endpoints support zero retention? Support: Yes. We shared the configuration guide and confirmed the account setting is enabled for the pilot workspace.",
    },
    {
      pylonId: `${DEMO_PREFIX}pylon-acme-01`, number: 1003, companyName: "Acme Robotics", companyDomain: "acme-robotics.example",
      title: "Intermittent cold start above one second", state: "open", priority: "urgent", createdAt: isoDaysAgo({ now, days: 5, hour: 16 }), requesterEmail: "iris@acme-robotics.example",
      conversation: "Iris Okafor: Three evaluation runs had cold starts above one second. Support: We found the endpoint was scaling to zero and suggested a minimum replica setting for the next benchmark.",
    },
    {
      pylonId: `${DEMO_PREFIX}pylon-meridian-01`, number: 1004, companyName: "Meridian Finance", companyDomain: "meridian.example",
      title: "Request archived invoice history", state: "closed", priority: "low", createdAt: isoDaysAgo({ now, days: 10, hour: 10 }), requesterEmail: "noah@meridian.example",
      conversation: "Noah Williams: We need the final invoice archive for our records. Support: The archive was exported and delivered through the secure portal.",
    },
    {
      pylonId: `${DEMO_PREFIX}pylon-luma-01`, number: 1005, companyName: "Luma Commerce", companyDomain: "luma-commerce.example",
      title: "Batch API concurrency guidance", state: "open", priority: "medium", createdAt: isoDaysAgo({ now, days: 7, hour: 13 }), requesterEmail: "eva@luma-commerce.example",
      conversation: "Eva Rossi: What concurrency do you recommend for two million catalog records? Support: Start with fifty concurrent jobs, watch rate-limit headers, and increase gradually after the first sample.",
    },
  ];

  return { companies, calls, tickets };
}
