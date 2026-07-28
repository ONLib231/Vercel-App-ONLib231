import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 * Server-only: never import this from a Client Component, and never send
 * `SUPABASE_SERVICE_ROLE_KEY` to the browser (it is deliberately NOT
 * prefixed with NEXT_PUBLIC_).
 *
 * Why this exists: vendor signup uploads two private documents and inserts
 * a vendor_applications row *before* the new user necessarily has a session
 * (Supabase's default email-confirmation flow creates the auth.users row
 * immediately but returns no session until the confirmation link is
 * clicked). There's no `auth.uid()` yet for the owner-scoped RLS policies on
 * vendor_applications / the vendor-documents bucket to check against, so
 * this trusted server action performs those two writes with the service
 * role instead — tagging the storage path / row with the *just-created*
 * user id from the signUp() response, not anything client-supplied.
 */
export function createSupabaseServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (Project Settings > API > service_role) — " +
        "required for vendor document uploads during signup."
    );
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
