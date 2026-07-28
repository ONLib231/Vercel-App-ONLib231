"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentAuthUser } from "@/lib/user";
import { isSuperAdmin } from "@/lib/super-admin";
import type { CategoryFormInput, ServiceOptionFormInput } from "@/types/super-admin";
import type { ProfileRow, VendorApplicationStatus } from "@/types/vendor";

export interface SuperAdminActionResult {
  ok: boolean;
  error?: string;
}

async function requireSuperAdmin(): Promise<SuperAdminActionResult | null> {
  if (!(await isSuperAdmin())) {
    return { ok: false, error: "Super Admin access required." };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vendor application review — replaces the old "run this SQL by hand" step
// from 0004/0005's migration comments. Uses the regular authenticated
// client: the vendor_applications_admin_update policy (0007) is what makes
// this legal for a role='admin' session, and approving triggers the
// existing trg_vendor_applications_approved trigger (auto-provisions the
// vendor's store) the same way a hand-written SQL UPDATE always did.
// ---------------------------------------------------------------------------
export async function reviewVendorApplication(
  applicationId: string,
  decision: Extract<VendorApplicationStatus, "approved" | "rejected">,
  reviewerNotes?: string
): Promise<SuperAdminActionResult> {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  try {
    const reviewer = await getCurrentAuthUser();
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from("vendor_applications")
      .update({
        status: decision,
        reviewer_notes: reviewerNotes?.trim() || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewer?.id ?? null,
      })
      .eq("id", applicationId);

    if (error) {
      console.error("[reviewVendorApplication] Update failed:", error.message);
      return { ok: false, error: "Couldn't save this decision. Please try again." };
    }

    revalidatePath("/admin/vendor-applications");
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    console.error("[reviewVendorApplication] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong reviewing this application. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// User & role management — profiles has no admin-facing RLS policy by
// design (0003: querying profiles from within a profiles policy recurses),
// so this is the one Super Admin write that has to go through the
// service-role client rather than the caller's own session.
// ---------------------------------------------------------------------------
export async function updateUserRole(userId: string, newRole: ProfileRow["role"]): Promise<SuperAdminActionResult> {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  try {
    const currentUser = await getCurrentAuthUser();
    if (currentUser?.id === userId && newRole !== "admin") {
      // No UI-driven way to promote the *next* Super Admin if the only one
      // demotes themselves first — same reasoning as 0007's migration
      // header bootstrap note.
      return { ok: false, error: "You can't remove your own admin access from here — have another admin do it." };
    }

    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", userId);

    if (error) {
      console.error("[updateUserRole] Update failed:", error.message);
      return { ok: false, error: "Couldn't update this user's role. Please try again." };
    }

    revalidatePath("/admin/users");
    return { ok: true };
  } catch (err) {
    console.error("[updateUserRole] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong updating this user's role. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Categories — categories_admin_write (0002) already covers all commands
// for role='admin', so this uses the regular authenticated client.
// ---------------------------------------------------------------------------
export async function saveCategory(input: CategoryFormInput): Promise<SuperAdminActionResult> {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  const name = input.name?.trim();
  const slug = input.slug?.trim().toLowerCase();
  if (!name || !slug) return { ok: false, error: "Name and slug are required." };

  try {
    const supabase = createSupabaseServerClient();
    const fields = { name, slug, icon: input.icon || "grid", sort_order: input.sortOrder, is_active: input.isActive };
    const { error } = input.id
      ? await supabase.from("categories").update(fields).eq("id", input.id)
      : await supabase.from("categories").insert(fields);

    if (error) {
      console.error("[saveCategory] Save failed:", error.message);
      return { ok: false, error: "Couldn't save this category — the slug may already be in use." };
    }

    revalidatePath("/admin/categories");
    revalidatePath("/marketplace");
    return { ok: true };
  } catch (err) {
    console.error("[saveCategory] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong saving this category. Please try again." };
  }
}

export async function deleteCategory(id: string): Promise<SuperAdminActionResult> {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) {
      console.error("[deleteCategory] Delete failed:", error.message);
      return { ok: false, error: "Couldn't delete this category. Please try again." };
    }
    revalidatePath("/admin/categories");
    revalidatePath("/marketplace");
    return { ok: true };
  } catch (err) {
    console.error("[deleteCategory] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong deleting this category. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Service cards (landing screen) — service_options_admin_write (0001)
// covers all commands for role='admin'. Only the two seeded rows
// ('delivery' / 'marketplace') exist — this edits in place, no create/delete
// (the underlying service_key enum only has those two values).
// ---------------------------------------------------------------------------
export async function updateServiceOption(input: ServiceOptionFormInput): Promise<SuperAdminActionResult> {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  const title = input.title?.trim();
  const subtitle = input.subtitle?.trim();
  const route = input.route?.trim();
  if (!title || !subtitle || !route) return { ok: false, error: "Title, subtitle, and route are all required." };

  try {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from("service_options")
      .update({
        title,
        subtitle,
        badge_label: input.badgeLabel?.trim() || "",
        badge_icon: input.badgeIcon,
        accent: input.accent,
        route,
        sort_order: input.sortOrder,
        is_active: input.isActive,
      })
      .eq("id", input.id);

    if (error) {
      console.error("[updateServiceOption] Update failed:", error.message);
      return { ok: false, error: "Couldn't save this service card. Please try again." };
    }

    revalidatePath("/admin/service-cards");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error("[updateServiceOption] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong saving this service card. Please try again." };
  }
}
