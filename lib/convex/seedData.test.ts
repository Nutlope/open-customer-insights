import { describe, expect, test } from "bun:test";
import { buildDemoSeedData, DEMO_PREFIX } from "./seedData";

describe("buildDemoSeedData", () => {
  test("builds deterministic, clearly synthetic records", () => {
    const first = buildDemoSeedData({ now: Date.UTC(2026, 7, 24) });
    const second = buildDemoSeedData({ now: Date.UTC(2026, 7, 24) });

    expect(first).toEqual(second);
    expect(first.companies.length).toBeGreaterThanOrEqual(5);
    expect(first.companies.every((company) => company.domain.endsWith(".example"))).toBe(true);
    expect(first.calls.every((call) => call.gongId.startsWith(DEMO_PREFIX))).toBe(true);
    expect(first.tickets.every((ticket) => ticket.pylonId.startsWith(DEMO_PREFIX))).toBe(true);
    expect(new Set(first.calls.map((call) => call.gongId)).size).toBe(first.calls.length);
    expect(new Set(first.tickets.map((ticket) => ticket.pylonId)).size).toBe(first.tickets.length);
  });
});
