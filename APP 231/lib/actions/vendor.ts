"use server";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import type { IdDocumentType } from "@/types/vendor";

const VENDOR_DOCUMENTS_BUCKET = "vendor-documents";

export interface VendorSignupFields {
  userId: string;
  fullName: string;
  email: string;
  businessName: string;
  idDocumentType: IdDocumentType;
  businessRegistrationFile: File;
  idDocumentFile: File;
}

export interface VendorApplicationResult {
  ok: boolean;
  error?: string;
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop();
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return file.type.split("/")[1] ?? "bin";
  return "bin";
}

/**
 * Uploads the two vendor documents to the private "vendor-documents" bucket
 * and inserts a public.vendor_applications row (status defaults to
 * 'pending'). Called right after supabase.auth.signUp() succeeds for a
 * "Vendor" signup — see lib/actions/auth.ts.
 *
 * Uses the service-role client (see lib/supabase/service-role.ts) because a
 * brand-new signup may not have a session yet (email confirmation pending),
 * so there's no authenticated `auth.uid()` for the owner-scoped RLS
 * policies on this bucket/table to check against.
 *
 * There's deliberately no email notification here — review happens directly
 * in Supabase (see supabase/migrations/0005_vendor_application_review_view.sql
 * for a review-friendly view + the approve/reject SQL) until the Super Admin
 * panel ships. The application row itself, not an email, is the source of
 * truth for what needs review.
 */
export async function submitVendorApplication(fields: VendorSignupFields): Promise<VendorApplicationResult> {
  try {
    const supabase = createSupabaseServiceRoleClient();

    const businessRegPath = `${fields.userId}/business-registration.${extensionFor(fields.businessRegistrationFile)}`;
    const idDocPath = `${fields.userId}/id-document.${extensionFor(fields.idDocumentFile)}`;

    const [businessRegUpload, idDocUpload] = await Promise.all([
      supabase.storage.from(VENDOR_DOCUMENTS_BUCKET).upload(businessRegPath, fields.businessRegistrationFile, {
        upsert: true,
        contentType: fields.businessRegistrationFile.type || undefined,
      }),
      supabase.storage.from(VENDOR_DOCUMENTS_BUCKET).upload(idDocPath, fields.idDocumentFile, {
        upsert: true,
        contentType: fields.idDocumentFile.type || undefined,
      }),
    ]);

    if (businessRegUpload.error) {
      console.error("[submitVendorApplication] Business registration upload failed:", businessRegUpload.error.message);
      return { ok: false, error: "Couldn't upload your business registration document. Please try again." };
    }
    if (idDocUpload.error) {
      console.error("[submitVendorApplication] ID document upload failed:", idDocUpload.error.message);
      return { ok: false, error: "Couldn't upload your identification document. Please try again." };
    }

    const { error: insertError } = await supabase.from("vendor_applications").upsert(
      {
        user_id: fields.userId,
        business_name: fields.businessName,
        id_document_type: fields.idDocumentType,
        business_registration_path: businessRegPath,
        id_document_path: idDocPath,
        status: "pending",
      },
      { onConflict: "user_id" }
    );

    if (insertError) {
      console.error("[submitVendorApplication] Failed to insert vendor_applications row:", insertError.message);
      return { ok: false, error: "Your documents uploaded, but we couldn't file your application. Please contact support." };
    }

    console.log(
      `[submitVendorApplication] New vendor application from "${fields.businessName}" (${fields.email}) saved with ` +
        `status='pending'. Review it in Supabase via the public.vendor_applications_review view (SQL Editor), ` +
        `or query public.vendor_applications directly.`
    );

    return { ok: true };
  } catch (err) {
    console.error("[submitVendorApplication] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong submitting your vendor application. Please try again." };
  }
}
