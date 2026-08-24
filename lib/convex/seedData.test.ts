import { describe, expect, test } from "bun:test";
import { buildDemoCompetitorRows, buildDemoSeedData, DEMO_PREFIX } from "./seedData";

describe("buildDemoSeedData", () => {
  test("builds deterministic, clearly synthetic records", () => {
    const first = buildDemoSeedData({ now: Date.UTC(2026, 7, 24) });
    const second = buildDemoSeedData({ now: Date.UTC(2026, 7, 24) });

    expect(first).toEqual(second);
    expect(first.companies).toHaveLength(12);
    expect(first.calls).toHaveLength(36);
    expect(first.tickets).toHaveLength(48);
    expect(first.companies.every((company) => company.domain.endsWith(".example"))).toBe(true);
    expect(first.calls.every((call) => call.gongId.startsWith(DEMO_PREFIX))).toBe(true);
    expect(first.tickets.every((ticket) => ticket.pylonId.startsWith(DEMO_PREFIX))).toBe(true);
    expect(new Set(first.calls.map((call) => call.gongId)).size).toBe(first.calls.length);
    expect(new Set(first.tickets.map((ticket) => ticket.pylonId)).size).toBe(first.tickets.length);
    expect(first.companies.every((company) => first.calls.some((call) => call.companyDomain === company.domain))).toBe(true);
    expect(first.companies.every((company) => first.tickets.some((ticket) => ticket.companyDomain === company.domain))).toBe(true);
  });

  test("builds a varied competitor leaderboard from calls and tickets", () => {
    const data = buildDemoSeedData({ now: Date.UTC(2026, 7, 24) });
    const competitors = buildDemoCompetitorRows({ data });

    expect(competitors.length).toBeGreaterThanOrEqual(10);
    expect(competitors.every((competitor) => competitor.domain.endsWith(".demo.example"))).toBe(true);
    expect(competitors.some((competitor) => competitor.name === "Fireworks" && competitor.calls > 0)).toBe(true);
    expect(competitors.some((competitor) => competitor.tickets > 0)).toBe(true);
  });
});
