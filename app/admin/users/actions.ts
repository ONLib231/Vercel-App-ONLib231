"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";

export async function updateUserRoleAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as Enums<"user_role">;

  if (!userId || !["customer", "vendor", "admin"].includes(role)) return;
  if (userId === admin.id && role !== "admin") {
    // Refuse to let an admin demote themselves out of the only session that
    // can undo it — RLS would also block it via prevent_role_self_escalation
    // only if is_admin() flips false mid-transaction, but failing fast here
    // avoids a confusing silent no-op.
    return;
  }

  // The calling session is an admin, and the profiles RLS update policy
  // ("profiles: update own or admin") + the role-escalation trigger both
  // explicitly allow an is_admin() session to change any profile's role, so
  // this uses the regular RLS-scoped client rather than service-role.
  const supabase = await createClient();
  await supabase.from("profiles").update({ role }).eq("id", userId);

  revalidatePath("/admin/users");
}
