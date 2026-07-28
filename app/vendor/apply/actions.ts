"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { submitVendorApplication } from "@/lib/vendor";
import type { Enums } from "@/lib/supabase/database.types";

export type VendorApplyState = { error: string | null };

export async function submitVendorApplicationAction(
  _prevState: VendorApplyState,
  formData: FormData
): Promise<VendorApplyState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/vendor/apply");
  }

  const businessName = String(formData.get("business_name") ?? "").trim();
  const rawDocType = String(formData.get("id_document_type") ?? "");
  if (!["passport", "national_id", "drivers_license"].includes(rawDocType)) {
    return { error: "Select a valid ID document type." };
  }
  if (!businessName) {
    return { error: "Business name is required." };
  }

  const regFile = formData.get("business_registration");
  const idFile = formData.get("id_document");

  const result = await submitVendorApplication({
    userId: user.id,
    businessName,
    idDocumentType: rawDocType as Enums<"id_document_type">,
    businessRegistrationFile: regFile instanceof File && regFile.size > 0 ? regFile : null,
    idDocumentFile: idFile instanceof File && idFile.size > 0 ? idFile : null,
  });

  if (result.error) {
    return { error: result.error };
  }

  revalidatePath("/vendor/apply");
  redirect("/vendor/apply?submitted=1");
}
