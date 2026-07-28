"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getSiteUrl } from "@/lib/site";
import { submitVendorApplication } from "@/lib/actions/vendor";
import type { IdDocumentType, ProfileRow, VendorApplicationRow } from "@/types/vendor";

export interface AuthActionResult {
  ok: boolean;
  error?: string;
  /** Sign-up succeeded but Supabase requires the user to confirm their
   *  email before a session exists — no redirect happens in that case. */
  needsEmailConfirmation?: boolean;
  /** Which account type this result is for — lets SignupForm show the right
   *  success copy ("check your email" vs "application submitted"). */
  accountType?: "customer" | "vendor";
}

function friendlyAuthError(message: string): string {
  const known: Record<string, string> = {
    "Invalid login credentials": "Incorrect email or password.",
    "User already registered": "An account with that email already exists — try logging in instead.",
    "Email not confirmed": "Please confirm your email before logging in — check your inbox.",
  };
  return known[message] ?? message;
}

export interface SignInParams {
  email: string;
  password: string;
  next?: string;
}

/** Backs the Login page's email/password form. */
export async function signInWithPassword({ email, password, next }: SignInParams): Promise<AuthActionResult> {
  if (!email || !password) {
    return { ok: false, error: "Enter both your email and password." };
  }

  // Vendors are identified purely by their login details — no separate
  // portal URL — so this same action decides, after checking profiles.role,
  // whether to land them on /marketplace or their /vendor dashboard.
  let redirectTarget = next && next.startsWith("/") ? next : "/marketplace";

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { ok: false, error: friendlyAuthError(error.message) };
    }

    const userId = data.user?.id;
    if (userId) {
      // Cast explicitly rather than relying on inference: .maybeSingle()'s
      // result on a narrow (non-"*") select has been unreliable in this
      // project's pinned @supabase/postgrest-js version, silently resolving
      // to `never` instead of the selected columns' real type — see the
      // getMyStore() fix in lib/vendor.ts for the same underlying issue.
      const { data: profileData } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      const profile = profileData as Pick<ProfileRow, "role"> | null;

      if (profile?.role === "vendor") {
        const { data: applicationData } = await supabase
          .from("vendor_applications")
          .select("status")
          .eq("user_id", userId)
          .maybeSingle();
        const application = applicationData as Pick<VendorApplicationRow, "status"> | null;

        redirectTarget = application?.status === "approved" ? "/vendor" : "/vendor/pending";
      }
    }
  } catch (err) {
    console.error("[signInWithPassword] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  revalidatePath(redirectTarget.startsWith("/vendor") ? "/vendor" : "/marketplace");
  redirect(redirectTarget);
}

/**
 * Backs the Sign Up page's create-account form for BOTH account types
 * (Customer and Vendor — there's no separate vendor signup page, just an
 * "I want to" toggle on this same form). Takes FormData rather than a plain
 * object because a Vendor signup includes two file uploads (business
 * registration + identification document).
 */
export async function signUpAccount(formData: FormData): Promise<AuthActionResult> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();
  const nextRaw = formData.get("next");
  const next = typeof nextRaw === "string" && nextRaw ? nextRaw : undefined;
  const accountType: "customer" | "vendor" = formData.get("accountType") === "vendor" ? "vendor" : "customer";

  if (!fullName || !email || !password || !phone) {
    return { ok: false, error: "Fill in your name, email, contact number, and password." };
  }
  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  let businessName = "";
  let idDocumentType: IdDocumentType | null = null;
  let businessRegistrationFile: File | null = null;
  let idDocumentFile: File | null = null;

  if (accountType === "vendor") {
    businessName = String(formData.get("businessName") ?? "").trim();
    const idDocumentTypeRaw = String(formData.get("idDocumentType") ?? "");
    const businessRegistrationEntry = formData.get("businessRegistrationFile");
    const idDocumentEntry = formData.get("idDocumentFile");
    businessRegistrationFile = businessRegistrationEntry instanceof File ? businessRegistrationEntry : null;
    idDocumentFile = idDocumentEntry instanceof File ? idDocumentEntry : null;

    if (!businessName) {
      return { ok: false, error: "Enter your business name." };
    }
    if (!["passport", "national_id", "drivers_license"].includes(idDocumentTypeRaw)) {
      return { ok: false, error: "Select an identification document type." };
    }
    idDocumentType = idDocumentTypeRaw as IdDocumentType;
    if (!businessRegistrationFile || businessRegistrationFile.size === 0) {
      return { ok: false, error: "Upload your business registration document." };
    }
    if (!idDocumentFile || idDocumentFile.size === 0) {
      return { ok: false, error: "Upload your identification document (Passport, National ID, or Driver's License)." };
    }
  }

  const redirectTarget = next && next.startsWith("/") ? next : "/marketplace";
  let sessionCreated = false;

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone, role: accountType },
        emailRedirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(
          accountType === "vendor" ? "/vendor/pending" : redirectTarget
        )}`,
      },
    });

    if (error) {
      return { ok: false, error: friendlyAuthError(error.message) };
    }
    if (!data.user) {
      return { ok: false, error: "Something went wrong creating your account. Please try again." };
    }

    sessionCreated = Boolean(data.session);

    if (accountType === "vendor" && businessRegistrationFile && idDocumentFile && idDocumentType) {
      const vendorResult = await submitVendorApplication({
        userId: data.user.id,
        fullName,
        email,
        businessName,
        idDocumentType,
        businessRegistrationFile,
        idDocumentFile,
      });

      if (!vendorResult.ok) {
        // Don't leave a half-registered account behind — the auth user
        // exists but has no vendor_applications row to be reviewed.
        try {
          const serviceRole = createSupabaseServiceRoleClient();
          await serviceRole.auth.admin.deleteUser(data.user.id);
        } catch (rollbackErr) {
          console.error("[signUpAccount] Failed to roll back auth user after a failed vendor submission:", rollbackErr);
        }
        return { ok: false, error: vendorResult.error ?? "Couldn't submit your vendor application. Please try again." };
      }
    }
  } catch (err) {
    console.error("[signUpAccount] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  if (accountType === "vendor") {
    // Approval (by the future Super Admin panel) is required before a
    // vendor gets a dashboard — never auto-redirect into /vendor here,
    // regardless of whether a session already exists.
    return { ok: true, needsEmailConfirmation: !sessionCreated, accountType: "vendor" };
  }

  if (!sessionCreated) {
    // With email confirmations enabled (the Supabase default), signUp
    // succeeds but returns no session yet — the user has to click the
    // confirmation link first, which lands on /auth/callback.
    return { ok: true, needsEmailConfirmation: true, accountType: "customer" };
  }

  revalidatePath("/marketplace");
  redirect(redirectTarget);
}

/** Backs the "Sign in with Google" button on both Login and Sign Up. */
export async function signInWithGoogle(next?: string): Promise<AuthActionResult> {
  const redirectTarget = next && next.startsWith("/") ? next : "/marketplace";

  let url: string | null = null;

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(redirectTarget)}`,
      },
    });

    if (error) {
      return { ok: false, error: friendlyAuthError(error.message) };
    }
    url = data.url;
  } catch (err) {
    console.error("[signInWithGoogle] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  if (!url) {
    return { ok: false, error: "Google sign-in isn't configured yet." };
  }

  redirect(url);
}

/**
 * Signs the current user out and sends them back to the marketplace
 * homepage as a guest. Bound to the Sidebar's "Logout" button — the
 * corresponding "Login" link (shown when signed out) points at `/login`.
 */
export async function signOut(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/marketplace");
  redirect("/marketplace");
}
