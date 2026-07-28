"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      setError(oauthError.message);
      setLoading(false);
    }
    // On success the browser is redirected to Google, so no further local
    // state update is needed.
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={loading} className="btn-secondary">
        <span className="text-lg font-bold text-red-500">G</span>
        {loading ? "Redirecting…" : "Sign in with Google"}
      </button>
      {error ? <p className="mt-1 text-xs text-brand-red">{error}</p> : null}
    </div>
  );
}
