import type { Metadata } from "next";
import Link from "next/link";
import { getVendorApplications } from "@/lib/super-admin";
import { VendorApplicationsManager } from "@/components/admin/VendorApplicationsManager";
import type { VendorApplicationStatus } from "@/types/vendor";

export const metadata: Metadata = {
  title: "Vendor Applications — Super Admin",
};

const VALID_STATUSES: VendorApplicationStatus[] = ["pending", "approved", "rejected"];

const TABS: { label: string; value: VendorApplicationStatus | undefined }[] = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: undefined },
];

function isValidStatus(value: string): value is VendorApplicationStatus {
  return (VALID_STATUSES as string[]).includes(value);
}

export default async function VendorApplicationsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  // No query param -> default to the Pending tab (the actual review queue);
  // "all" is the explicit escape hatch to see every application unfiltered.
  // Anything else unrecognized (garbage/typo'd query string) also falls
  // back to Pending rather than silently querying with an invalid status.
  const rawStatus = searchParams.status;
  const activeTab: VendorApplicationStatus | undefined =
    rawStatus === "all" ? undefined : rawStatus && isValidStatus(rawStatus) ? rawStatus : "pending";
  const applications = await getVendorApplications(activeTab);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Vendor Applications</h1>
        <p className="text-sm text-slate-500">Approve or reject signups — approving auto-creates the vendor's store.</p>
      </div>

      <div className="flex gap-2">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.value;
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/admin/vendor-applications?status=${tab.value}` : "/admin/vendor-applications?status=all"}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                isActive ? "bg-verta-600 text-white" : "border border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <VendorApplicationsManager applications={applications} />
    </div>
  );
}
