import { afterEach, describe, expect, test } from "bun:test";
import { isAdminEmail } from "./auth";

const originalAdminEmails = process.env.ADMIN_EMAILS;

afterEach(() => {
  if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = originalAdminEmails;
});

describe("isAdminEmail", () => {
  test("grants no implicit administrators", () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAdminEmail({ email: "person@example.com" })).toBe(false);
  });

  test("uses the configured comma-separated allowlist", () => {
    process.env.ADMIN_EMAILS = "first@example.com, SECOND@example.com";
    expect(isAdminEmail({ email: "second@example.com" })).toBe(true);
    expect(isAdminEmail({ email: "other@example.com" })).toBe(false);
  });
});
