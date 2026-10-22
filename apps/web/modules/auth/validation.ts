import { z } from "zod";
import type { AuthFieldErrors, AuthMessage } from "./types";

const signInSchema = z.object({
  badgeNumber: z
    .string({ error: "badge_required" })
    .trim()
    .min(1, { error: "badge_required" })
    .regex(/^[^\s@]+$/u, { error: "badge_invalid" }),
  // Passwords must retain every character, including surrounding whitespace.
  password: z
    .string({ error: "password_required" })
    .min(1, { error: "password_required" }),
});

const messages: Record<string, AuthMessage> = {
  badge_required: {
    fr: "Saisissez votre matricule.",
    en: "Enter your badge number.",
  },
  badge_invalid: {
    fr: "Saisissez un matricule valide.",
    en: "Enter a valid badge number.",
  },
  password_required: {
    fr: "Saisissez votre mot de passe.",
    en: "Enter your password.",
  },
};

export function validateSignIn(
  input: unknown,
):
  | { success: true; data: z.infer<typeof signInSchema> }
  | { success: false; fieldErrors: AuthFieldErrors } {
  const result = signInSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };

  const fieldErrors: AuthFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (
      (field === "badgeNumber" || field === "password") &&
      !fieldErrors[field]
    ) {
      fieldErrors[field] =
        messages[issue.message] ??
        messages[
          field === "badgeNumber" ? "badge_required" : "password_required"
        ];
    }
  }
  if (!Object.keys(fieldErrors).length) {
    fieldErrors.badgeNumber = messages.badge_required;
    fieldErrors.password = messages.password_required;
  }
  return { success: false, fieldErrors };
}
