import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/health") {
    return NextResponse.next();
  }

  const pendingCookies = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const responseHeaders = new Headers({
    "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
    Expires: "0",
    Pragma: "no-cache",
  });
  let hasValidSession = false;

  try {
    const { url, anonKey } = getSupabaseConfig();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const cookie of cookiesToSet) {
            request.cookies.set(cookie.name, cookie.value);
            pendingCookies.set(cookie.name, cookie);
          }

          // SSR delivers cache headers only with the first cookie write.
          for (const [name, value] of Object.entries(headers)) {
            responseHeaders.set(name, value);
          }
        },
      },
    });

    // Verify with Supabase Auth; cookie presence or getSession() is not proof.
    const { data, error } = await supabase.auth.getUser();
    hasValidSession = !error && Boolean(data.user);
  } catch {
    // Authentication failures and outages must never open a protected route.
    hasValidSession = false;
  }

  const response =
    hasValidSession || pathname === "/login"
      ? NextResponse.next({ request: { headers: request.headers } })
      : NextResponse.redirect(
          new URL("/login", request.url),
          request.method === "GET" || request.method === "HEAD" ? 307 : 303,
        );

  for (const { name, value, options } of pendingCookies.values()) {
    response.cookies.set(name, value, options);
  }

  for (const [name, value] of responseHeaders) {
    response.headers.set(name, value);
  }

  return response;
}
