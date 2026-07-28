import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock3, ShieldAlert } from "lucide-react";
import { getNavUser } from "@/lib/user";
import { getVendorApplication } from "@/lib/vendor";
import { signOut } from "@/lib/actions/auth";

export const metadata: Metadata = {
  title: "Vendor Application — ONLib",
};

/**
 * Deliberately its own route OUTSIDE app/vendor/layout.tsx (not a child of
 * it) — that layout redirects here precisely because the application isn't
 * approved yet, so this page can't depend on the same gate without looping.
 */
export default async function VendorPendingPage() {
  const navUser = await getNavUser();
  if (!navUser) {
    redirect("/login?next=/vendor");
    return null;
  }
  if (navUser.role !== "vendor") {
    redirect("/marketplace");
    return null;
  }

  const application = await getVendorApplication();
  if (application?.status === "approved") {
    redirect("/vendor");
    return null;
  }

  const rejected = application?.status === "rejected";
  const missing = !application;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-4 py-10 text-center">
      {rejected ? (
        <ShieldAlert className="h-12 w-12 text-onlib-600" aria-hidden />
      ) : (
        <Clock3 className="h-12 w-12 text-verta-600" aria-hidden />
      )}

      <h1 className="text-2xl font-extrabold text-verta-900">
        {missing
          ? "No vendor application found"
          : rejected
            ? "Your vendor application wasn't approved"
            : "Your vendor application is under review"}
      </h1>

      <p className="max-w-md text-sm text-slate-600">
        {missing
          ? "Your account is marked as a vendor, but we don't have a business registration / ID submission on file. Please contact support."
          : rejected
            ? (application?.reviewer_notes ??
              "Contact support for details, or reach out to update your business registration or identification documents.")
            : `We received your business registration and identification documents for "${application?.business_name}". Our team reviews new vendor applications directly in Supabase — there's no email notification for this yet, so check back and log in again once your store has been approved to reach your Vendor Dashboard.`}
      </p>

      <form action={signOut}>
        <button type="submit" className="mt-2 text-sm font-semibold text-onlib-600 hover:text-onlib-700">
          Logout
        </button>
      </form>
    </div>
  );
}
