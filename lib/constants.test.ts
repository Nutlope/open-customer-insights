import { describe, expect, test } from "bun:test";
import { resolveAppUrl } from "./constants";

describe("resolveAppUrl", () => {
  test("uses the local development URL when no deployment URL is configured", () => {
    expect(resolveAppUrl({})).toBe("http://localhost:3030");
  });

  test("normalizes a configured deployment URL", () => {
    expect(resolveAppUrl({ configuredUrl: " https://insights.example.com/// " })).toBe(
      "https://insights.example.com"
    );
  });
});
