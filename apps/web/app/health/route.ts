import { connection } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

function diagnosticResponse(message: string, status: number, anonKey?: string) {
  return new Response(
    anonKey ? message.replaceAll(anonKey, "[clé anon masquée]") : message,
    {
      status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET() {
  // Run the probe for each request, including when Cache Components is enabled.
  await connection();

  let anonKey: string | undefined;

  try {
    const config = getSupabaseConfig();
    anonKey = config.anonKey;
    const endpoint = new URL(
      "auth/v1/settings",
      `${config.url.replace(/\/+$/, "")}/`,
    );

    // This public API works without a user, table, or database migration.
    const response = await fetch(endpoint, {
      headers: { apikey: anonKey, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();

    if (response.status !== 200) {
      return diagnosticResponse(
        `HTTP ${response.status} ${response.statusText}\n${body}`,
        503,
        anonKey,
      );
    }

    const settings: unknown = JSON.parse(body);

    if (
      typeof settings !== "object" ||
      settings === null ||
      !("external" in settings) ||
      typeof settings.external !== "object" ||
      settings.external === null ||
      Array.isArray(settings.external) ||
      !("disable_signup" in settings) ||
      typeof settings.disable_signup !== "boolean"
    ) {
      return diagnosticResponse(
        `Réponse Supabase inattendue (HTTP 200)\n${body}`,
        503,
        anonKey,
      );
    }

    return diagnosticResponse("Supabase : connecté", 200);
  } catch (error) {
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}${
            error.cause instanceof Error
              ? `\n${error.cause.name}: ${error.cause.message}`
              : ""
          }`
        : String(error);

    return diagnosticResponse(message, 503, anonKey);
  }
}
