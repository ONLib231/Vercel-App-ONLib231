// lib/auth.ts
// Server-only helpers for reading the current session's profile and gating
// access to role-specific areas of the app. Every function has an explicit
// return type so a Supabase query result is never relied on to infer
// correctly at a call site.
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Profile = Tables<"profiles">;

/** Returns the signed-in user's profile row, or null if signed out. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error }: { data: Profile | null; error: { message: string } | null } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("getCurrentProfile: failed to load profile", error.message);
    return null;
  }

  return data;
}

/** Redirects to /login if signed out; otherwise returns the profile. */
export async function requireProfile(redirectTo = "/login"): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect(redirectTo);
  }
  return profile;
}

/** Redirects to / if not an admin (Super Admin + Delivery Admin dashboards). */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile("/login?next=/admin");
  if (profile.role !== "admin") {
    redirect("/");
  }
  return profile;
}

export type VendorApplication = Tables<"vendor_applications">;

/**
 * Redirects to /vendor/apply unless the signed-in user has an approved
 * vendor_applications row. Returns the profile + application + their store.
 */
export async function requireApprovedVendor(): Promise<{
  profile: Profile;
  application: VendorApplication;
  store: Tables<"stores">;
}> {
  const profile = await requireProfile("/login?next=/vendor/dashboard");
  const supabase = await createClient();

  const { data: application }: { data: VendorApplication | null } = await supabase
    .from("vendor_applications")
    .select("*")
    .eq("user_id", profile.id)
    .maybeSingle();

  if (!application || application.status !== "approved") {
    redirect("/vendor/apply");
  }

  const { data: store }: { data: Tables<"stores"> | null } = await supabase
    .from("stores")
    .select("*")
    .eq("owner_id", profile.id)
    .maybeSingle();

  if (!store) {
    // Approved but the store row hasn't been provisioned yet — should not
    // normally happen since approval provisions it in the same transaction,
    // but fail safe rather than crash the dashboard.
    redirect("/vendor/apply?status=awaiting_store");
  }

  return { profile, application, store };
}
