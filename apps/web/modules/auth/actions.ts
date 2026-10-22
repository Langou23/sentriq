"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { badgeNumberToEmail } from "./index";
import type { AuthActionError, AuthErrorCode } from "./types";

function authenticationError(code: AuthErrorCode): AuthActionError {
  const messages = {
    invalid_input: {
      fr: "Saisissez un matricule valide et un mot de passe.",
      en: "Enter a valid badge number and password.",
    },
    invalid_credentials: {
      fr: "Matricule ou mot de passe incorrect.",
      en: "Incorrect badge number or password.",
    },
    service_unavailable: {
      fr: "Authentification indisponible. Réessayez plus tard.",
      en: "Authentication is unavailable. Please try again later.",
    },
  };

  return { success: false, code, message: messages[code] };
}

export async function signIn(
  badgeNumber: string,
  password: string,
): Promise<AuthActionError> {
  if (
    typeof badgeNumber !== "string" ||
    typeof password !== "string" ||
    !badgeNumber.trim() ||
    /[\s@]/u.test(badgeNumber.trim()) ||
    !password
  ) {
    return authenticationError("invalid_input");
  }

  try {
    const supabase = await createClient({ requireCookieWrites: true });
    const { data, error } = await supabase.auth.signInWithPassword({
      email: badgeNumberToEmail(badgeNumber),
      password,
    });

    if (error) {
      return authenticationError(
        !error.status || error.status === 429 || error.status >= 500
          ? "service_unavailable"
          : "invalid_credentials",
      );
    }

    if (!data.user || !data.session) {
      return authenticationError("invalid_credentials");
    }
  } catch {
    return authenticationError("service_unavailable");
  }

  revalidatePath("/", "layout");
  redirect("/");
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
