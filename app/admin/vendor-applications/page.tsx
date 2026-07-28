import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { VendorApplicationRow } from "./VendorApplicationRow";
import type { Tables } from "@/lib/supabase/database.types";

const SIGNED_URL_TTL_SECONDS = 60 * 10;

export default async function VendorApplicationsPage() {
  const supabase = createServiceRoleClient();

  const { data: applications }: { data: Tables<"vendor_applications">[] | null } = await supabase
    .from("vendor_applications")
    .select("*")
    .order("status", { ascending: true }) // 'approved' < 'pending' < 'rejected' alphabetically; pending still surfaces near top visually via badge
    .order("created_at", { ascending: false });

  const rows = await Promise.all(
    (applications ?? []).map(async (application) => {
      const businessRegistrationUrl = application.business_registration_path
        ? await signUrl(supabase, application.business_registration_path)
        : null;
      const idDocumentUrl = application.id_document_path ? await signUrl(supabase, application.id_document_path) : null;
      return { application, businessRegistrationUrl, idDocumentUrl };
    })
  );

  const pending = rows.filter((r) => r.application.status === "pending");
  const reviewed = rows.filter((r) => r.application.status !== "pending");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-4 text-2xl font-bold text-slate-900">Pending Vendor Applications</h1>
        {pending.length === 0 ? (
          <p className="card p-8 text-center text-sm text-slate-400">Nothing waiting for review.</p>
        ) : (
          <div className="space-y-4">
            {pending.map((row) => (
              <VendorApplicationRow
                key={row.application.id}
                application={row.application}
                businessRegistrationUrl={row.businessRegistrationUrl}
                idDocumentUrl={row.idDocumentUrl}
              />
            ))}
          </div>
        )}
      </div>

      {reviewed.length > 0 ? (
        <div>
          <h2 className="mb-4 text-lg font-bold text-slate-900">Previously Reviewed</h2>
          <div className="space-y-4">
            {reviewed.map((row) => (
              <VendorApplicationRow
                key={row.application.id}
                application={row.application}
                businessRegistrationUrl={row.businessRegistrationUrl}
                idDocumentUrl={row.idDocumentUrl}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

async function signUrl(supabase: ReturnType<typeof createServiceRoleClient>, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("vendor-documents").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error("Failed to sign vendor document URL:", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}
