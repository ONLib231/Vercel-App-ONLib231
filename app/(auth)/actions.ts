"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import { submitVendorApplication } from "@/lib/vendor";
import type { Enums } from "@/lib/supabase/database.types";

export type AuthActionState = { error: string | null };

export async function signInAction(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect(next || "/");
}

export async function signUpAction(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const accountType = String(formData.get("account_type") ?? "customer") as "customer" | "vendor";
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !password) {
    return { error: "Name, email, and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  let businessName = "";
  let idDocumentType: Enums<"id_document_type"> | null = null;
  let businessRegistrationFile: File | null = null;
  let idDocumentFile: File | null = null;

  if (accountType === "vendor") {
    businessName = String(formData.get("business_name") ?? "").trim();
    const rawDocType = String(formData.get("id_document_type") ?? "");
    if (!["passport", "national_id", "drivers_license"].includes(rawDocType)) {
      return { error: "Select a valid ID document type." };
    }
    idDocumentType = rawDocType as Enums<"id_document_type">;

    if (!businessName) {
      return { error: "Business name is required for vendor signups." };
    }

    const regFile = formData.get("business_registration");
    const idFile = formData.get("id_document");
    businessRegistrationFile = regFile instanceof File && regFile.size > 0 ? regFile : null;
    idDocumentFile = idFile instanceof File && idFile.size > 0 ? idFile : null;

    if (!businessRegistrationFile || !idDocumentFile) {
      return { error: "Both a business registration document and an ID document are required to apply as a vendor." };
    }
  }

  const siteUrl = await getSiteUrl();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        // Read by the handle_new_user() trigger (0001_extensions_and_profiles.sql)
        // to set profiles.role at insert time.
        requested_role: accountType,
      },
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  const newUserId = data.user?.id;
  if (!newUserId) {
    return { error: "Sign up did not return a user. Please try again." };
  }

  if (accountType === "vendor" && idDocumentType) {
    const result = await submitVendorApplication({
      userId: newUserId,
      businessName,
      idDocumentType,
      businessRegistrationFile,
      idDocumentFile,
    });

    if (result.error) {
      // The auth account was created, but the application submission failed.
      // Send them to /vendor/apply so they can retry the upload once signed in
      // rather than losing the account entirely.
      redirect(`/vendor/apply?upload_error=${encodeURIComponent(result.error)}`);
    }
  }

  if (!data.session) {
    // Email confirmation is required before a session exists.
    redirect("/login?confirm_email=1");
  }

  redirect(accountType === "vendor" ? "/vendor/apply?submitted=1" : "/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
