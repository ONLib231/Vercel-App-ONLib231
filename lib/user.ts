import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { HeaderCounts, NavUser } from "@/types/marketplace";

/**
 * Shown in the desktop marketplace header ("Girlee Fashion / Customer" in
 * the mockup) when nobody is signed in / the Auth module hasn't shipped yet.
 * The mobile header has no equivalent slot, so this only affects desktop.
 */
const GUEST_NAV_USER: NavUser = {
  name: "Guest",
  role: "Sign in",
  avatarUrl: null,
};

const ZERO_COUNTS: HeaderCounts = { cart: 0, wishlist: 0, notifications: 0 };

/**
 * Raw Supabase auth user for this request, deduped with React's `cache()`
 * so the Sidebar, header, bottom tab bar, and page content — which each
 * need to know sign-in state — share a single `auth.getUser()` call per
 * request instead of one each.
 */
export const getCurrentAuthUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch (err) {
    console.error("[getCurrentAuthUser] Unexpected failure:", err);
    return null;
  }
});

/** Convenience boolean for gating actions (e.g. "Add to Cart") behind sign-in. */
export async function isSignedIn(): Promise<boolean> {
  return (await getCurrentAuthUser()) !== null;
}

/**
 * Resolves the current signed-in user's display info for the marketplace
 * header/user-menu. Depends on public.profiles (full_name, role), which is
 * introduced by the Auth & Role-Routing module — until that migration
 * lands this simply falls back to a guest state instead of throwing.
 */
export async function getNavUser(): Promise<NavUser | null> {
  try {
    const user = await getCurrentAuthUser();
    if (!user) return null;

    const supabase = createSupabaseServerClient();
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      // profiles table not created yet, or no row for this user — degrade
      // to a minimal identity rather than breaking the header.
      return { name: user.email ?? "Account", role: "Customer", avatarUrl: null };
    }

    return {
      name: profile.full_name ?? user.email ?? "Account",
      role: profile.role ?? "Customer",
      avatarUrl: null,
    };
  } catch (err) {
    console.error("[getNavUser] Unexpected failure:", err);
    return null;
  }
}

export function resolveNavUser(user: NavUser | null): NavUser {
  return user ?? GUEST_NAV_USER;
}

/**
 * Cart / wishlist / notification badge counts for the header and bottom
 * tab bar. Returns zeros for a signed-out visitor, and degrades to zeros
 * (rather than throwing) if the underlying tables aren't reachable yet.
 */
export async function getHeaderCounts(): Promise<HeaderCounts> {
  try {
    const user = await getCurrentAuthUser();
    if (!user) return ZERO_COUNTS;

    const supabase = createSupabaseServerClient();
    const [cart, wishlist, notifications] = await Promise.all([
      supabase.from("cart_items").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("wishlist_items").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false),
    ]);

    return {
      cart: cart.count ?? 0,
      wishlist: wishlist.count ?? 0,
      notifications: notifications.count ?? 0,
    };
  } catch (err) {
    console.error("[getHeaderCounts] Unexpected failure:", err);
    return ZERO_COUNTS;
  }
}
