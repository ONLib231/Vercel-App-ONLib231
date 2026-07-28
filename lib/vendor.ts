// lib/vendor.ts
// Shared vendor-application submission logic used by both the signup flow
// (app/(auth)/actions.ts) and the standalone re-apply page
// (app/vendor/apply/actions.ts), so document upload + upsert logic lives in
// exactly one place.
import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Enums } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type SubmitVendorApplicationInput = {
  userId: string;
  businessName: string;
  idDocumentType: Enums<"id_document_type">;
  businessRegistrationFile: File | null;
  idDocumentFile: File | null;
};

export type SubmitVendorApplicationResult = { error: string | null };

/**
 * Uploads whichever documents were provided (private vendor-documents
 * bucket, service-role write only — see supabase/migrations/0007_storage.sql)
 * and upserts the vendor_applications row back to status='pending'. Used
 * both at signup time and for later re-submission after a rejection.
 */
export async function submitVendorApplication(
  input: SubmitVendorApplicationInput
): Promise<SubmitVendorApplicationResult> {
  const supabase = createServiceRoleClient();

  let businessRegistrationPath: string | null = null;
  let idDocumentPath: string | null = null;

  try {
    if (input.businessRegistrationFile && input.businessRegistrationFile.size > 0) {
      businessRegistrationPath = await uploadVendorDocument(
        supabase,
        input.userId,
        "business-registration",
        input.businessRegistrationFile
      );
    }

    if (input.idDocumentFile && input.idDocumentFile.size > 0) {
      idDocumentPath = await uploadVendorDocument(supabase, input.userId, "id-document", input.idDocumentFile);
    }
  } catch (uploadError) {
    const message = uploadError instanceof Error ? uploadError.message : "Document upload failed.";
    return { error: message };
  }

  const { error } = await supabase.from("vendor_applications").upsert(
    {
      user_id: input.userId,
      business_name: input.businessName,
      id_document_type: input.idDocumentType,
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
      ...(businessRegistrationPath ? { business_registration_path: businessRegistrationPath } : {}),
      ...(idDocumentPath ? { id_document_path: idDocumentPath } : {}),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

async function uploadVendorDocument(
  supabase: SupabaseClient<Database>,
  userId: string,
  baseName: "business-registration" | "id-document",
  file: File
): Promise<string> {
  const extension = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${userId}/${baseName}.${extension}`;

  const { error } = await supabase.storage
    .from("vendor-documents")
    .upload(path, file, { upsert: true, contentType: file.type || undefined });

  if (error) {
    throw new Error(`Failed to upload ${baseName.replace("-", " ")}: ${error.message}`);
  }

  return path;
}
