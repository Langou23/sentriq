import "server-only";

import { createServerClient } from "@supabase/ssr";
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
