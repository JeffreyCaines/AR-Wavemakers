import { describe, expect, it } from "vitest";
import {
  isValidAdminEmail,
  normalizeAdminEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordRequirementStates,
  validatePassword,
} from "./passwordPolicy";

const EMAIL = "admin@example.com";
const VALID = "StrongPass1!x";

describe("normalizeAdminEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeAdminEmail("  Admin@Example.COM ")).toBe("admin@example.com");
  });
});

describe("isValidAdminEmail", () => {
  it("accepts a normal email", () => {
    expect(isValidAdminEmail("person@technl.ca")).toBe(true);
  });

  it("rejects missing domain", () => {
    expect(isValidAdminEmail("person@")).toBe(false);
    expect(isValidAdminEmail("not-an-email")).toBe(false);
  });
});

describe("passwordRequirementStates", () => {
  it("marks every rule unmet when the password is empty", () => {
    expect(passwordRequirementStates("", EMAIL).every((rule) => !rule.met)).toBe(true);
  });

  it("updates each rule independently", () => {
    const byId = Object.fromEntries(
      passwordRequirementStates("Abc", EMAIL).map((rule) => [rule.id, rule.met])
    );
    expect(byId.length).toBe(false);
    expect(byId.lowercase).toBe(true);
    expect(byId.uppercase).toBe(true);
    expect(byId.digit).toBe(false);
    expect(byId.special).toBe(false);
    expect(byId.notEmail).toBe(true);
  });

  it("marks all rules met for a valid password", () => {
    expect(passwordRequirementStates(VALID, EMAIL).every((rule) => rule.met)).toBe(true);
  });

  it("fails notEmail when the password matches the email", () => {
    const notEmail = passwordRequirementStates("abcdefghij1!", "abcdefghij1!").find(
      (rule) => rule.id === "notEmail"
    );
    expect(notEmail?.met).toBe(false);
  });
});

describe("validatePassword", () => {
  it("accepts a password that meets every rule", () => {
    expect(validatePassword(VALID, EMAIL)).toEqual({ ok: true });
  });

  it("rejects empty and short passwords", () => {
    expect(validatePassword("", EMAIL).ok).toBe(false);
    expect(validatePassword("Ab1!" + "x".repeat(PASSWORD_MIN_LENGTH - 5), EMAIL).ok).toBe(false);
  });

  it("rejects passwords over the max length", () => {
    const tooLong = `Aa1!${"x".repeat(PASSWORD_MAX_LENGTH)}`;
    expect(validatePassword(tooLong, EMAIL).ok).toBe(false);
  });

  it("requires mixed case, a digit, and a special character", () => {
    expect(validatePassword("strongpass1!x", EMAIL).ok).toBe(false);
    expect(validatePassword("STRONGPASS1!X", EMAIL).ok).toBe(false);
    expect(validatePassword("StrongPass!!x", EMAIL).ok).toBe(false);
    expect(validatePassword("StrongPass12x", EMAIL).ok).toBe(false);
  });

  it("rejects a password that matches the email", () => {
    const result = validatePassword("Abcdefghij1!", "abcdefghij1!");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/email/i);
    }
  });

  it("rejects a new password that matches the current password", () => {
    const result = validatePassword(VALID, EMAIL, { currentPassword: VALID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/differ/i);
    }
  });
});
