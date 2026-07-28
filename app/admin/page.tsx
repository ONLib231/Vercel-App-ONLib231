import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, Package, ShoppingBag, Store, Truck, Users } from "lucide-react";
import { getPlatformStats } from "@/lib/super-admin";
import { StatCard } from "@/components/vendor/StatCard";

export const metadata: Metadata = {
  title: "Super Admin — ONLib",
};

export default async function SuperAdminDashboardPage() {
  const stats = await getPlatformStats();

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Super Admin</h1>
        <p className="text-sm text-slate-500">Platform-wide overview across Marketplace and Delivery.</p>
      </div>

      {stats.pendingVendorApplications > 0 && (
        <Link
          href="/admin/vendor-applications"
          className="flex items-center justify-between rounded-2xl bg-gradient-to-br from-verta-900 to-verta-700 px-5 py-4 text-white shadow-sm"
        >
          <span className="flex items-center gap-3">
            <ClipboardCheck className="h-5 w-5" aria-hidden />
            <span className="text-sm font-semibold">
              {stats.pendingVendorApplications} vendor application{stats.pendingVendorApplications === 1 ? "" : "s"} awaiting review
            </span>
          </span>
          <span className="text-sm font-semibold">Review →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard icon={ClipboardCheck} label="Pending Vendor Apps" value={stats.pendingVendorApplications} />
        <StatCard icon={Store} label="Approved Vendors" value={stats.approvedVendors} />
        <StatCard icon={Users} label="Total Users" value={stats.totalUsers} />
        <StatCard icon={Package} label="Total Stores" value={stats.totalStores} />
        <StatCard icon={ShoppingBag} label="Marketplace Orders" value={stats.totalMarketplaceOrders} />
        <StatCard icon={Truck} label="Delivery Orders" value={stats.totalDeliveryOrders} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/admin/vendor-applications" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-verta-400">
          <p className="text-sm font-bold text-slate-900">Review vendor applications</p>
          <p className="text-xs text-slate-500">Approve or reject pending signups.</p>
        </Link>
        <Link href="/admin/users" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-verta-400">
          <p className="text-sm font-bold text-slate-900">Manage users & roles</p>
          <p className="text-xs text-slate-500">Promote or demote any account.</p>
        </Link>
        <Link href="/admin/categories" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-verta-400">
          <p className="text-sm font-bold text-slate-900">Edit categories</p>
          <p className="text-xs text-slate-500">Update the Marketplace homepage quick-links.</p>
        </Link>
        <Link href="/admin/service-cards" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-verta-400">
          <p className="text-sm font-bold text-slate-900">Edit service cards</p>
          <p className="text-xs text-slate-500">Update the Delivery/Marketplace landing cards.</p>
        </Link>
      </div>
    </div>
  );
}
