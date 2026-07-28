import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ApplyForm } from "./ApplyForm";
import type { Tables } from "@/lib/supabase/database.types";

export default async function VendorApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; upload_error?: string; status?: string }>;
}) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/vendor/apply");

  const supabase = await createClient();
  const { data: application }: { data: Tables<"vendor_applications"> | null } = await supabase
    .from("vendor_applications")
    .select("*")
    .eq("user_id", profile.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Sell on ONLib</h1>
      <p className="mb-6 text-sm text-slate-500">
        Vendor accounts require a quick review of your business registration and ID before you get dashboard access.
      </p>

      {params.submitted ? (
        <p className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-brand-blue">Application submitted — we&rsquo;ll email you once it&rsquo;s reviewed.</p>
      ) : null}
      {params.upload_error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-brand-red">
          Your account was created, but the document upload failed: {params.upload_error}. Please retry below.
        </p>
      ) : null}

      {application?.status === "approved" ? (
        <div className="card p-6 text-center">
          <p className="font-semibold text-green-700">Your vendor application is approved 🎉</p>
          <Link href="/vendor/dashboard" className="mt-3 inline-block font-semibold text-brand-blue hover:underline">
            Go to your dashboard
          </Link>
        </div>
      ) : application?.status === "pending" ? (
        <div className="card p-6 text-center">
          <p className="font-semibold text-slate-700">Your application is under review.</p>
          <p className="mt-1 text-sm text-slate-500">Submitted {new Date(application.created_at).toLocaleDateString()}.</p>
        </div>
      ) : (
        <div className="card p-6">
          {application?.status === "rejected" ? (
            <div className="mb-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-brand-red">
              Your previous application was rejected{application.rejection_reason ? `: ${application.rejection_reason}` : "."} You can resubmit below.
            </div>
          ) : null}
          <ApplyForm defaultBusinessName={application?.business_name} submitLabel={application ? "Resubmit application" : "Submit application"} />
        </div>
      )}
    </div>
  );
}
