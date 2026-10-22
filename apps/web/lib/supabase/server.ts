import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";

export async function createClient({
  requireCookieWrites = false,
}: { requireCookieWrites?: boolean } = {}) {
  const { url, anonKey } = getSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch (error) {
          if (requireCookieWrites) {
            throw error;
          }

          // Server Components cannot write cookies; the Proxy refreshes sessions.
          // Server Actions require successful writes instead of hiding failures.
        }
      },
    },
  });
}

// Keep a password session private until its application profile is authorized.
export async function createSignInClient() {
  const { url, anonKey } = getSupabaseConfig();
  const cookieStore = await cookies();
  const pendingCookies = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        const currentCookies = new Map(
          cookieStore.getAll().map((cookie) => [cookie.name, cookie]),
        );
        for (const cookie of pendingCookies.values())
          currentCookies.set(cookie.name, cookie);
        return Array.from(currentCookies.values());
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet)
          pendingCookies.set(cookie.name, cookie);
      },
    },
  });

  return {
    supabase,
    commitSessionCookies() {
      for (const { name, value, options } of pendingCookies.values())
        cookieStore.set(name, value, options);
      pendingCookies.clear();
    },
    clearSessionCookies() {
      const names = new Set(pendingCookies.keys());
      for (const { name } of cookieStore.getAll()) {
        if (
          name === storageKey ||
          name.startsWith(`${storageKey}.`) ||
          name.startsWith(`${storageKey}-`)
        )
          names.add(name);
      }
      // Discard staged tokens even if the response cookie store rejects a write.
      const optionsByName = new Map(pendingCookies);
      pendingCookies.clear();
      for (const name of names) {
        const options = optionsByName.get(name)?.options;
        cookieStore.set(name, "", {
          ...options,
          path: options?.path ?? "/",
          maxAge: 0,
          expires: new Date(0),
        });
      }
    },
  };
}
