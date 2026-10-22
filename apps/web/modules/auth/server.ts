import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { profileSchema, roleHomes } from "./profile";
import type { AuthProfile, UserRole } from "./types";

async function readVerifiedProfile(): Promise<AuthProfile | null> {
  try {
    const supabase = await createClient();
    // Reverify identity independently of the proxy before reading protected data.
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user?.id) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("id,badge_number,first_name,last_name,role,is_active")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (error) return null;

    const profile = profileSchema.safeParse(data);
    if (
      !profile.success ||
      !profile.data.is_active ||
      profile.data.id !== auth.user.id
    )
      return null;

    return {
      id: profile.data.id,
      badgeNumber: profile.data.badge_number,
      firstName: profile.data.first_name,
      lastName: profile.data.last_name,
      role: profile.data.role,
      isActive: true,
    };
  } catch {
    // Auth, configuration, and database failures must not expose a protected page.
    return null;
  }
}

// Public server entry point. Never cache identity or profile state across requests.
export async function requireProfile(
  expectedRole?: UserRole,
): Promise<AuthProfile> {
  // Supabase initializes Auth in the background; keep it out of prerendering.
  await connection();
  const profile = await readVerifiedProfile();
  if (!profile) redirect("/login");
  if (expectedRole && profile.role !== expectedRole)
    redirect(roleHomes[profile.role]);
  return profile;
}

export async function redirectToRoleHome(): Promise<never> {
  const profile = await requireProfile();
  redirect(roleHomes[profile.role]);
}
