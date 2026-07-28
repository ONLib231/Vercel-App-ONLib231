import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Browser-side Supabase client — the first one this codebase needs. Every
 * feature up to this point (Marketplace, Vendor Dashboard) has been server
 * rendered with no client-side Supabase calls. Live order tracking is
 * different: a sender/admin's screen needs to update the moment a Postgres
 * row changes, without a page reload, which only works from inside the
 * browser via Supabase Realtime (see components/delivery/*).
 *
 * Safe to call repeatedly (e.g. once per Client Component) — it's a thin
 * wrapper, not a singleton connection; Supabase's realtime client
 * multiplexes subscriptions over one underlying websocket per browser tab
 * regardless of how many times this is called.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
