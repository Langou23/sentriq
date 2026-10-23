import { describe, expect, it } from "vitest";
import { badgeNumberToEmail } from "../index";

describe("badgeNumberToEmail", () => {
  it.each([
    { input: "123456", email: "123456@sentriq.local" },
    { input: "000001", email: "000001@sentriq.local" },
    { input: "0", email: "0@sentriq.local" },
    { input: "  000042  ", email: "000042@sentriq.local" },
    { input: "\t0073\n", email: "0073@sentriq.local" },
    {
      input: "000123456789012345678901234567890",
      email: "000123456789012345678901234567890@sentriq.local",
    },
  ])("converts $input without losing identifier digits", ({ input, email }) => {
    expect(badgeNumberToEmail(input)).toBe(email);
  });

  it.each([
    { label: "empty input", input: "" },
    { label: "whitespace only", input: " \t\n " },
    { label: "letters", input: "ABC" },
    { label: "letters mixed with digits", input: "AG001" },
    { label: "embedded whitespace", input: "000 001" },
    { label: "embedded newline", input: "000\n001" },
    { label: "hyphen", input: "000-001" },
    { label: "underscore", input: "000_001" },
    { label: "positive sign", input: "+000001" },
    { label: "negative sign", input: "-000001" },
    { label: "decimal notation", input: "0.00001" },
    { label: "exponent notation", input: "1e6" },
    { label: "hexadecimal notation", input: "0x10" },
    { label: "email address", input: "000001@example.com" },
    { label: "Arabic-Indic digits", input: "٠٠٠٠٠١" },
    { label: "full-width digits", input: "０００００１" },
  ])("rejects $label instead of creating an email", ({ input }) => {
    expect(() => badgeNumberToEmail(input)).toThrow();
  });
});
