// lib/supabase/service-role.ts
// SERVER-ONLY. Bypasses Row Level Security entirely — use only from trusted
// server code (server actions, route handlers) that has already performed
// its own authorization check. Never import this from a Client Component,
// and never expose SUPABASE_SERVICE_ROLE_KEY via a NEXT_PUBLIC_ variable.
//
// Used for: vendor document uploads at signup (no session may exist yet for
// a brand-new user in the same request that creates their account), vendor
// application approval (provisioning the store row + updating profiles.role),
// and the delivery-order notification fan-out (writing in-app notifications
// to every admin profile).
import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let cachedClient: SupabaseClient<Database> | null = null;

export function createServiceRoleClient(): SupabaseClient<Database> {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. The service-role client must only be constructed server-side, with SUPABASE_SERVICE_ROLE_KEY set (never as NEXT_PUBLIC_)."
    );
  }

  cachedClient = createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return cachedClient;
}
