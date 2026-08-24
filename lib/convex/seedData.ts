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
  competitorMentions?: string[];
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
  competitorMentions?: string[];
};

type ActivityScenario = {
  companyDomain: string;
  companyName: string;
  contactName: string;
  workload: string;
  positiveSignal: string;
  blocker: string;
  featureRequest: string;
  competitor: string;
  competitorReason: string;
};

export type DemoSeedData = {
  companies: CompanySeed[];
  calls: CallSeed[];
  tickets: TicketSeed[];
};

export type DemoCompetitorRow = {
  name: string;
  domain: string;
  calls: number;
  tickets: number;
  total: number;
  lastSeen: string | null;
};

function isoDaysAgo({ now, days, hour = 14 }: { now: number; days: number; hour?: number }): string {
  const date = new Date(now - days * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function demoSlug({ domain }: { domain: string }): string {
  return domain.replace(/\.example$/, "").replace(/[^a-z0-9]+/g, "-");
}

function buildGeneratedCalls({
  scenario,
  scenarioIndex,
  now,
  count,
  ordinalStart,
}: {
  scenario: ActivityScenario;
  scenarioIndex: number;
  now: number;
  count: number;
  ordinalStart: number;
}): CallSeed[] {
  const slug = demoSlug({ domain: scenario.companyDomain });
  const repName = ["Avery Brooks", "Riley Morgan", "Jamie Torres", "Drew Sullivan"][scenarioIndex % 4] ?? "Avery Brooks";
  const repEmail = `rep-${scenarioIndex + 1}@example.com`;
  const templates = [
    {
      title: `${scenario.companyName} product roadmap review`,
      brief: `${scenario.companyName} is seeing ${scenario.positiveSignal}, while ${scenario.featureRequest} would unlock the next stage of adoption.`,
      keyPoints: [scenario.positiveSignal, scenario.featureRequest, `${scenario.workload} remains the primary workload`],
      transcript: `${scenario.contactName}: We are seeing ${scenario.positiveSignal}. ${repName}: What would help the team expand next? ${scenario.contactName}: ${scenario.featureRequest} would make the biggest difference for our ${scenario.workload}.`,
      competitorMentions: [],
    },
    {
      title: `${scenario.companyName} reliability deep dive`,
      brief: `${scenario.companyName} needs help with ${scenario.blocker} before expanding its ${scenario.workload} workload.`,
      keyPoints: [scenario.blocker, "A technical follow-up is scheduled", "Expansion remains possible after validation"],
      transcript: `${scenario.contactName}: Our main blocker is ${scenario.blocker}. ${repName}: We will reproduce that with your traffic pattern and share a mitigation. ${scenario.contactName}: Once it is stable, we can move more of the ${scenario.workload} workload.`,
      competitorMentions: [],
    },
    {
      title: `${scenario.companyName} vendor planning session`,
      brief: `${scenario.companyName} is comparing Together with ${scenario.competitor} because ${scenario.competitorReason}.`,
      keyPoints: [`${scenario.competitor} is in the evaluation`, scenario.competitorReason, "Decision criteria were documented"],
      transcript: `${scenario.contactName}: We are also evaluating ${scenario.competitor} because ${scenario.competitorReason}. ${repName}: We will prepare a side-by-side benchmark for the ${scenario.workload} workload. ${scenario.contactName}: That will help us make the decision this quarter.`,
      competitorMentions: [scenario.competitor],
    },
  ];

  return templates.slice(0, count).map((template, index) => ({
    gongId: `${DEMO_PREFIX}gong-${slug}-${String(ordinalStart + index).padStart(2, "0")}`,
    companyDomain: scenario.companyDomain,
    title: template.title,
    started: isoDaysAgo({ now, days: 2 + scenarioIndex * 3 + index * 5 }),
    duration: 1_620 + scenarioIndex * 75 + index * 420,
    parties: [
      { name: scenario.contactName, emailAddress: `${slug}@${scenario.companyDomain}` },
      { name: repName, emailAddress: repEmail },
    ],
    brief: template.brief,
    keyPoints: template.keyPoints,
    transcript: template.transcript,
    competitorMentions: template.competitorMentions,
  }));
}

function buildGeneratedTickets({
  scenario,
  scenarioIndex,
  now,
  count,
  ordinalStart,
}: {
  scenario: ActivityScenario;
  scenarioIndex: number;
  now: number;
  count: number;
  ordinalStart: number;
}): TicketSeed[] {
  const slug = demoSlug({ domain: scenario.companyDomain });
  const templates = [
    {
      title: `Investigate ${scenario.blocker}`,
      state: "open",
      priority: scenarioIndex % 3 === 0 ? "urgent" : "high",
      conversation: `${scenario.contactName}: We need help with ${scenario.blocker}. Support: We opened an investigation and requested a trace from the latest ${scenario.workload} run.`,
      competitorMentions: [],
    },
    {
      title: `Feature request: ${scenario.featureRequest}`,
      state: "open",
      priority: "medium",
      conversation: `${scenario.contactName}: Could you add ${scenario.featureRequest}? Support: We documented the workflow, linked it to the product request, and will share progress in the next account review.`,
      competitorMentions: [],
    },
    {
      title: `${scenario.workload} configuration guidance`,
      state: "closed",
      priority: "low",
      conversation: `${scenario.contactName}: What configuration do you recommend for ${scenario.workload}? Support: We shared a tested configuration, rate-limit guidance, and monitoring thresholds. The customer confirmed the setup works.`,
      competitorMentions: [],
    },
    {
      title: `${scenario.competitor} migration comparison`,
      state: "in_progress",
      priority: "high",
      conversation: `${scenario.contactName}: We need a comparison with ${scenario.competitor} because ${scenario.competitorReason}. Support: We prepared benchmark criteria and scheduled a review with the solutions team.`,
      competitorMentions: [scenario.competitor],
    },
  ];

  return templates.slice(0, count).map((template, index) => ({
    pylonId: `${DEMO_PREFIX}pylon-${slug}-${String(ordinalStart + index).padStart(2, "0")}`,
    number: 2_000 + scenarioIndex * 10 + ordinalStart + index,
    companyName: scenario.companyName,
    companyDomain: scenario.companyDomain,
    title: template.title,
    state: template.state,
    priority: template.priority,
    createdAt: isoDaysAgo({ now, days: 3 + scenarioIndex * 2 + index * 4, hour: 9 + (index % 6) }),
    requesterEmail: `${slug}@${scenario.companyDomain}`,
    conversation: template.conversation,
    competitorMentions: template.competitorMentions,
  }));
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
    {
      domain: "orbit-logistics.example",
      name: "Orbit Logistics",
      status: "customer",
      description: "A logistics network automating shipment exception handling across regional carriers.",
      acr: 132_000,
      lifetimeRevenue: 205_000,
    },
    {
      domain: "cedar-education.example",
      name: "Cedar Education",
      status: "prospect",
      description: "An education platform building adaptive tutoring and multilingual course assistants.",
    },
    {
      domain: "atlas-legal.example",
      name: "Atlas Legal",
      status: "customer",
      description: "A legal operations platform extracting obligations and deadlines from contracts.",
      acr: 118_000,
      lifetimeRevenue: 176_000,
    },
    {
      domain: "harbor-energy.example",
      name: "Harbor Energy",
      status: "former_customer",
      description: "An energy analytics provider summarizing field reports and equipment telemetry.",
      lifetimeRevenue: 89_000,
    },
    {
      domain: "vela-games.example",
      name: "Vela Games",
      status: "customer",
      description: "A game studio generating localized dialogue and live-player support responses.",
      acr: 144_000,
      lifetimeRevenue: 221_000,
    },
    {
      domain: "juniper-security.example",
      name: "Juniper Security",
      status: "prospect",
      description: "A security startup triaging alerts and explaining suspicious activity to analysts.",
    },
    {
      domain: "mosaic-media.example",
      name: "Mosaic Media",
      status: "unknown",
      description: "A media workflow company producing metadata, summaries, and content recommendations.",
    },
  ];

  const activityScenarios: ActivityScenario[] = [
    { companyDomain: "northstar.example", companyName: "Northstar Labs", contactName: "Maya Chen", workload: "multimodal inference", positiveSignal: "28 percent better p95 latency", blocker: "project-level spend alerts arriving late", featureRequest: "project labels in usage exports", competitor: "Fireworks", competitorReason: "its team is testing burst capacity" },
    { companyDomain: "brightwave.example", companyName: "Brightwave Health", contactName: "Sam Patel", workload: "clinical summarization", positiveSignal: "more consistent summaries with fewer nurse corrections", blocker: "unclear retention evidence for compliance", featureRequest: "an auditable zero-retention configuration page", competitor: "Azure OpenAI", competitorReason: "procurement already has an enterprise agreement" },
    { companyDomain: "acme-robotics.example", companyName: "Acme Robotics", contactName: "Iris Okafor", workload: "robot vision inference", positiveSignal: "stable warm-endpoint latency", blocker: "cold starts occasionally exceeding one second", featureRequest: "explicit minimum replica controls", competitor: "Groq", competitorReason: "low latency is the primary benchmark" },
    { companyDomain: "meridian.example", companyName: "Meridian Finance", contactName: "Noah Williams", workload: "document extraction", positiveSignal: "strong extraction accuracy on complex filings", blocker: "queue delays during end-of-month spikes", featureRequest: "reserved burst capacity", competitor: "AWS", competitorReason: "finance wants vendor consolidation" },
    { companyDomain: "luma-commerce.example", companyName: "Luma Commerce", contactName: "Eva Rossi", workload: "catalog enrichment", positiveSignal: "high-quality product attributes in the pilot", blocker: "uncertain batch completion estimates", featureRequest: "predictive batch cost and completion reporting", competitor: "Baseten", competitorReason: "the team values managed batch orchestration" },
    { companyDomain: "orbit-logistics.example", companyName: "Orbit Logistics", contactName: "Luis Romero", workload: "shipment exception classification", positiveSignal: "18 percent fewer manual escalations", blocker: "rate limits during morning carrier imports", featureRequest: "per-tenant concurrency controls", competitor: "Modal", competitorReason: "its jobs API fits scheduled imports" },
    { companyDomain: "cedar-education.example", companyName: "Cedar Education", contactName: "Nadia Hassan", workload: "multilingual tutoring", positiveSignal: "strong Spanish and French lesson quality", blocker: "long first-token latency in classroom sessions", featureRequest: "regional endpoint selection", competitor: "Google Vertex AI", competitorReason: "the school network already uses Google Cloud" },
    { companyDomain: "atlas-legal.example", companyName: "Atlas Legal", contactName: "Theo Martin", workload: "contract obligation extraction", positiveSignal: "94 percent reviewer acceptance", blocker: "large contract uploads timing out", featureRequest: "asynchronous document job callbacks", competitor: "Anthropic", competitorReason: "legal reviewers prefer its long-context output" },
    { companyDomain: "harbor-energy.example", companyName: "Harbor Energy", contactName: "Priya Nair", workload: "field report summarization", positiveSignal: "accurate incident summaries", blocker: "unpredictable throughput during storm events", featureRequest: "capacity reservations by region", competitor: "AWS Bedrock", competitorReason: "the infrastructure team standardized on AWS" },
    { companyDomain: "vela-games.example", companyName: "Vela Games", contactName: "Kenji Sato", workload: "dialogue localization", positiveSignal: "launch localization time cut by two days", blocker: "occasional terminology drift across episodes", featureRequest: "shared terminology dictionaries", competitor: "OpenAI", competitorReason: "writers already prototype there" },
    { companyDomain: "juniper-security.example", companyName: "Juniper Security", contactName: "Amara Johnson", workload: "security alert triage", positiveSignal: "fewer false-positive escalations", blocker: "tool calls sometimes omit required evidence IDs", featureRequest: "strict tool schemas with validation telemetry", competitor: "Cerebras", competitorReason: "analysts need extremely fast interactive responses" },
    { companyDomain: "mosaic-media.example", companyName: "Mosaic Media", contactName: "Sofia Alvarez", workload: "video metadata generation", positiveSignal: "better topic labels than the legacy pipeline", blocker: "cost spikes on long-form archives", featureRequest: "automatic model routing by asset length", competitor: "Replicate", competitorReason: "the media team uses its existing model catalog" },
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
      competitorMentions: ["Fireworks", "Groq"],
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
      competitorMentions: ["AWS"],
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

  const domainsWithBaseRecords = new Set(calls.map((call) => call.companyDomain));
  for (const [scenarioIndex, scenario] of activityScenarios.entries()) {
    const hasBaseRecord = domainsWithBaseRecords.has(scenario.companyDomain);
    calls.push(...buildGeneratedCalls({
      scenario,
      scenarioIndex,
      now,
      count: hasBaseRecord ? 2 : 3,
      ordinalStart: hasBaseRecord ? 2 : 1,
    }));
  }

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

  const domainsWithBaseTickets = new Set(tickets.map((ticket) => ticket.companyDomain));
  for (const [scenarioIndex, scenario] of activityScenarios.entries()) {
    const hasBaseRecord = domainsWithBaseTickets.has(scenario.companyDomain);
    tickets.push(...buildGeneratedTickets({
      scenario,
      scenarioIndex,
      now,
      count: hasBaseRecord ? 3 : 4,
      ordinalStart: hasBaseRecord ? 2 : 1,
    }));
  }

  return { companies, calls, tickets };
}

export function buildDemoCompetitorRows({ data }: { data: DemoSeedData }): DemoCompetitorRow[] {
  const totals = new Map<string, { calls: number; tickets: number; lastSeen: string | null }>();
  for (const call of data.calls) {
    for (const name of call.competitorMentions ?? []) {
      const current = totals.get(name) ?? { calls: 0, tickets: 0, lastSeen: null };
      current.calls += 1;
      if (current.lastSeen === null || call.started > current.lastSeen) current.lastSeen = call.started;
      totals.set(name, current);
    }
  }
  for (const ticket of data.tickets) {
    for (const name of ticket.competitorMentions ?? []) {
      const current = totals.get(name) ?? { calls: 0, tickets: 0, lastSeen: null };
      current.tickets += 1;
      if (current.lastSeen === null || ticket.createdAt > current.lastSeen) current.lastSeen = ticket.createdAt;
      totals.set(name, current);
    }
  }

  return [...totals.entries()]
    .map(([name, counts]) => ({
      name,
      domain: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.demo.example`,
      calls: counts.calls,
      tickets: counts.tickets,
      total: counts.calls + counts.tickets,
      lastSeen: counts.lastSeen,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
