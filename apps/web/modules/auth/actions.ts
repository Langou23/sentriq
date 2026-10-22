"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createSignInClient } from "@/lib/supabase/server";
import { badgeNumberToEmail, validateSignIn } from "./index";
import type { AuthActionError, AuthErrorCode, AuthFieldErrors } from "./types";

const profileSchema = z.object({
  role: z.enum(["agent", "supervisor", "admin"]),
  is_active: z.boolean(),
});

const destinations = {
  agent: "/agent",
  supervisor: "/dispatch",
  admin: "/admin",
} as const;

function authenticationError(
  code: AuthErrorCode,
  fieldErrors?: AuthFieldErrors,
): AuthActionError {
  const messages = {
    invalid_input: {
      fr: "Saisissez un matricule valide et un mot de passe.",
      en: "Enter a valid badge number and password.",
    },
    invalid_credentials: {
      fr: "Matricule ou mot de passe invalide.",
      en: "Invalid badge number or password.",
    },
    account_disabled: {
      fr: "Compte désactivé, contactez votre superviseur.",
      en: "Account disabled. Contact your supervisor.",
    },
    service_unavailable: {
      fr: "Authentification indisponible. Réessayez plus tard.",
      en: "Authentication is unavailable. Please try again later.",
    },
  };

  return {
    success: false,
    code,
    message: messages[code],
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

async function rejectSession(
  context: Awaited<ReturnType<typeof createSignInClient>>,
  code: AuthErrorCode,
): Promise<AuthActionError> {
  try {
    await context.supabase.auth.signOut({ scope: "local" });
  } catch {
    // Local cookie removal must still run when the Auth service cannot revoke.
  }
  try {
    context.clearSessionCookies();
  } catch {
    return authenticationError("service_unavailable");
  }
  return authenticationError(code);
}

async function authenticate(input: unknown): Promise<AuthActionError> {
  const validation = validateSignIn(input);
  if (!validation.success)
    return authenticationError("invalid_input", validation.fieldErrors);

  let context: Awaited<ReturnType<typeof createSignInClient>> | undefined;
  let destination: (typeof destinations)[keyof typeof destinations];

  try {
    context = await createSignInClient();
    const { data, error } = await context.supabase.auth.signInWithPassword({
      email: badgeNumberToEmail(validation.data.badgeNumber),
      password: validation.data.password,
    });

    if (error) {
      return authenticationError(
        !error.status || error.status === 429 || error.status >= 500
          ? "service_unavailable"
          : "invalid_credentials",
      );
    }

    if (!data.user || !data.session) {
      return await rejectSession(context, "invalid_credentials");
    }

    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("role,is_active")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError)
      return await rejectSession(context, "service_unavailable");
    if (!profile || profile.is_active === false)
      return await rejectSession(context, "account_disabled");

    const parsedProfile = profileSchema.safeParse(profile);
    if (!parsedProfile.success)
      return await rejectSession(context, "service_unavailable");
    destination = destinations[parsedProfile.data.role];
    context.commitSessionCookies();
  } catch {
    return context
      ? await rejectSession(context, "service_unavailable")
      : authenticationError("service_unavailable");
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signIn(
  badgeNumber: string,
  password: string,
): Promise<AuthActionError> {
  return authenticate({ badgeNumber, password });
}

export async function signInFromForm(
  _previousState: AuthActionError | null,
  formData: FormData,
): Promise<AuthActionError> {
  return authenticate(
    formData instanceof FormData
      ? {
          badgeNumber: formData.get("badgeNumber"),
          password: formData.get("password"),
        }
      : null,
  );
}

export async function signOut(): Promise<AuthActionError> {
  try {
    const supabase = await createClient({ requireCookieWrites: true });
    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      return authenticationError("service_unavailable");
    }
  } catch {
    return authenticationError("service_unavailable");
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
