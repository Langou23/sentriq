export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL est manquante dans .env.local.");
  }

  if (!anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY est manquante dans .env.local.",
    );
  }

  return { url, anonKey };
}
