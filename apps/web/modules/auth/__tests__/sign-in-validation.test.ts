import { describe, expect, it } from "vitest";
import {
  validateSignIn,
  type AuthFieldErrors,
  type AuthMessage,
} from "../index";

function fieldErrors(input: unknown): AuthFieldErrors {
  const result = validateSignIn(input);
  expect(result.success).toBe(false);
  expect(result).not.toHaveProperty("data");
  if (result.success) throw new Error("Expected invalid sign-in input.");
  return result.fieldErrors;
}

function expectBilingual(message: AuthMessage | undefined): void {
  expect(message).toBeDefined();
  if (!message) throw new Error("Expected a bilingual field error.");
  expect(message.fr.trim()).not.toBe("");
  expect(message.en.trim()).not.toBe("");
  expect(message.fr).not.toBe(message.en);
}

describe("validateSignIn", () => {
  it.each(["password", "  password  ", " ", "Mot de passe — password!"])(
    "preserves the password %j and leading zeros while trimming the badge",
    (password) => {
      expect(validateSignIn({ badgeNumber: " \t000001\n ", password })).toEqual(
        {
          success: true,
          data: { badgeNumber: "000001", password },
        },
      );
    },
  );

  it("keeps large numeric identifiers as strings", () => {
    const badgeNumber = "000123456789012345678901234567890";
    expect(validateSignIn({ badgeNumber, password: "password" })).toEqual({
      success: true,
      data: { badgeNumber, password: "password" },
    });
  });

  it.each(["", " \t\n "])(
    "reports a missing badge %j in French and English",
    (badgeNumber) => {
      expect(fieldErrors({ badgeNumber, password: "password" })).toEqual({
        badgeNumber: {
          fr: "Saisissez votre matricule.",
          en: "Enter your badge number.",
        },
      });
    },
  );

  it("reports an empty password in French and English", () => {
    expect(fieldErrors({ badgeNumber: "000001", password: "" })).toEqual({
      password: {
        fr: "Saisissez votre mot de passe.",
        en: "Enter your password.",
      },
    });
  });

  it("reports both missing fields in French and English", () => {
    const errors = fieldErrors({ badgeNumber: "", password: "" });
    expect(Object.keys(errors).sort()).toEqual(["badgeNumber", "password"]);
    expectBilingual(errors.badgeNumber);
    expectBilingual(errors.password);
  });

  it.each([
    "ABC",
    "AG001",
    "000 001",
    "000-001",
    "+000001",
    "-000001",
    "0.00001",
    "1e6",
    "0x10",
    "٠٠٠٠٠١",
    "０００００１",
  ])(
    "requires ASCII digits for badge %j with bilingual feedback",
    (badgeNumber) => {
      expect(fieldErrors({ badgeNumber, password: "password" })).toEqual({
        badgeNumber: {
          fr: "Le matricule doit contenir uniquement des chiffres (0–9).",
          en: "Badge numbers must contain digits only (0–9).",
        },
      });
    },
  );

  const malformedInputs: { label: string; input: unknown }[] = [
    { label: "undefined", input: undefined },
    { label: "null", input: null },
    { label: "a string", input: "000001" },
    { label: "a number", input: 1 },
    { label: "a boolean", input: false },
    { label: "an array", input: [] },
    { label: "an empty object", input: {} },
    { label: "a missing password", input: { badgeNumber: "000001" } },
    { label: "a missing badge", input: { password: "password" } },
    {
      label: "a numeric badge value",
      input: { badgeNumber: 1, password: "password" },
    },
    {
      label: "a numeric password value",
      input: { badgeNumber: "000001", password: 123456 },
    },
  ];

  it.each(malformedInputs)("safely rejects $label", ({ input }) => {
    const errors = fieldErrors(input);
    expect(Object.keys(errors).length).toBeGreaterThan(0);
    for (const message of Object.values(errors)) expectBilingual(message);
  });

  it("does not return submitted secrets in validation failures", () => {
    const password = "private-test-password-value";
    const result = validateSignIn({ badgeNumber: "invalid", password });
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("data");
    expect(JSON.stringify(result)).not.toContain(password);
  });
});
