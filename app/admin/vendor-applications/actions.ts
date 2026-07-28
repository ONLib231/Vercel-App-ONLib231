"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { slugify } from "@/lib/utils";
import type { Tables } from "@/lib/supabase/database.types";

export type ReviewState = { error: string | null };

// Uses the service-role client (not the admin's own RLS-scoped session)
// because this single action touches rows owned by a *different* user
// (their vendor_applications row, a new stores row, their profiles.role,
// and an in-app notification for them) — notifications in particular has
// no insert policy for any authenticated role by design (see
// supabase/migrations/0009_rls_policies.sql), so service-role is the only
// way to write it. requireAdmin() is still the authorization gate: nobody
// without an admin session reaches the service-role calls below.
export async function approveVendorApplicationAction(_prevState: ReviewState, formData: FormData): Promise<ReviewState> {
  const admin = await requireAdmin();
  const applicationId = String(formData.get("application_id") ?? "");
  if (!applicationId) return { error: "Missing application id." };

  const supabase = createServiceRoleClient();

  const { data: application, error: fetchError }: { data: Tables<"vendor_applications"> | null; error: { message: string } | null } =
    await supabase.from("vendor_applications").select("*").eq("id", applicationId).maybeSingle();

  if (fetchError || !application) {
    return { error: fetchError?.message ?? "Application not found." };
  }

  const { error: updateError } = await supabase
    .from("vendor_applications")
    .update({ status: "approved", reviewed_by: admin.id, reviewed_at: new Date().toISOString(), rejection_reason: null })
    .eq("id", applicationId);

  if (updateError) return { error: updateError.message };

  const { data: existingStore }: { data: { id: string } | null } = await supabase
    .from("stores")
    .select("id")
    .eq("owner_id", application.user_id)
    .maybeSingle();

  if (!existingStore) {
    const slug = `${slugify(application.business_name)}-${Math.random().toString(36).slice(2, 7)}`;
    const { error: storeError } = await supabase.from("stores").insert({
      owner_id: application.user_id,
      name: application.business_name,
      slug,
    });
    if (storeError) return { error: storeError.message };
  }

  const { data: targetProfile }: { data: { role: string } | null } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", application.user_id)
    .maybeSingle();

  if (targetProfile && targetProfile.role !== "admin") {
    await supabase.from("profiles").update({ role: "vendor" }).eq("id", application.user_id);
  }

  await supabase.from("notifications").insert({
    user_id: application.user_id,
    title: "Vendor application approved",
    body: `${application.business_name} is now live. Head to your vendor dashboard to add products.`,
  });

  revalidatePath("/admin/vendor-applications");
  return { error: null };
}

export async function rejectVendorApplicationAction(_prevState: ReviewState, formData: FormData): Promise<ReviewState> {
  const admin = await requireAdmin();
  const applicationId = String(formData.get("application_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!applicationId) return { error: "Missing application id." };

  const supabase = createServiceRoleClient();

  const { data: application, error: fetchError }: { data: Tables<"vendor_applications"> | null; error: { message: string } | null } =
    await supabase.from("vendor_applications").select("*").eq("id", applicationId).maybeSingle();

  if (fetchError || !application) {
    return { error: fetchError?.message ?? "Application not found." };
  }

  const { error: updateError } = await supabase
    .from("vendor_applications")
    .update({
      status: "rejected",
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason || null,
    })
    .eq("id", applicationId);

  if (updateError) return { error: updateError.message };

  await supabase.from("notifications").insert({
    user_id: application.user_id,
    title: "Vendor application rejected",
    body: reason || "Your vendor application was not approved. You can review and resubmit it anytime.",
  });

  revalidatePath("/admin/vendor-applications");
  return { error: null };
}
