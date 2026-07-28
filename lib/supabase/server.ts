// lib/supabase/server.ts
// Supabase client for use in Server Components, Route Handlers, and Server
// Actions. Reads/writes the auth cookie via next/headers. Respects RLS as
// the currently signed-in user (anon key + user JWT from cookies) — this is
// NOT the service-role client.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check your .env.local against .env.local.example."
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll was called from a Server Component render, where cookies
          // can't be mutated. Safe to ignore: middleware.ts refreshes the
          // session cookie on every request, so this only matters when a
          // Server Component itself tries to refresh a near-expired token.
        }
      },
    },
  });
}
