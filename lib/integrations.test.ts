import { describe, expect, test } from "bun:test";
import {
  hasGongCredentials,
  hasPylonCredentials,
  hasSlackCredentials,
  hasTogetherCredentials,
  salesWinsConfig,
} from "./integrations";

describe("integration configuration", () => {
  test("requires complete credential pairs", () => {
    expect(hasGongCredentials({ env: { GONG_ACCESS_KEY: "key" } })).toBe(false);
    expect(hasGongCredentials({ env: { GONG_ACCESS_KEY: "key", GONG_ACCESS_KEY_SECRET: "secret" } })).toBe(true);
    expect(hasPylonCredentials({ env: { PYLON_API_KEY: "key" } })).toBe(true);
    expect(hasSlackCredentials({ env: { SLACK_MCP_XOXB_TOKEN: "token" } })).toBe(true);
    expect(hasTogetherCredentials({ env: { TOGETHER_API_KEY: "key" } })).toBe(true);
  });

  test("does not enable sales-wins ingestion from a partial configuration", () => {
    expect(salesWinsConfig({ env: { SALES_WINS_SLACK_CHANNEL_ID: "C123" } })).toBeNull();
    expect(salesWinsConfig({
      env: {
        SALES_WINS_SLACK_CHANNEL_ID: "C123",
        SALES_WINS_INITIAL_TIMESTAMP: "1700000000.000000",
      },
    })).toEqual({ channelId: "C123", initialTimestamp: "1700000000.000000" });
  });
});
