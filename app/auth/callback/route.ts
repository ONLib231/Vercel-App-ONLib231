import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Landing point for both flows Supabase sends users back to:
 *  - Google OAuth, after they approve on Google's consent screen
 *  - Email confirmation links (sign-up, magic link) if enabled
 * Exchanges the one-time `code` for a real session (setting the auth
 * cookies via createSupabaseServerClient), then continues on to wherever
 * the user was headed (`next`, defaulting to the marketplace homepage).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/marketplace";

  if (code) {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
