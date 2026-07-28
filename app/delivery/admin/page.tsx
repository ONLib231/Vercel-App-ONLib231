import type { Metadata } from "next";
import Link from "next/link";
import { Clock3, PackageCheck, Truck, Wallet } from "lucide-react";
import { getDeliveryDashboardStats } from "@/lib/delivery";
import { StatCard } from "@/components/vendor/StatCard";

export const metadata: Metadata = {
  title: "Delivery Admin — Verta",
};

export default async function DeliveryAdminDashboardPage() {
  const stats = await getDeliveryDashboardStats();

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Dispatch Dashboard</h1>
        <p className="text-sm text-slate-500">Live overview of Verta Delivery orders.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Clock3} label="Pending" value={stats.pendingCount} />
        <StatCard icon={Truck} label="In progress" value={stats.acceptedCount} />
        <StatCard icon={PackageCheck} label="Delivered today" value={stats.deliveredTodayCount} />
        <StatCard icon={Wallet} label="Revenue (30d)" value={stats.revenueLast30Label} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/delivery/admin/orders"
          className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-verta-400"
        >
          <p className="text-sm font-bold text-slate-900">Go to Orders board</p>
          <p className="text-xs text-slate-500">Accept pending orders, advance status, manage the queue.</p>
        </Link>
        <Link
          href="/delivery/admin/fleet"
          className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-verta-400"
        >
          <p className="text-sm font-bold text-slate-900">Manage Fleet</p>
          <p className="text-xs text-slate-500">Add agents and toggle who's on duty.</p>
        </Link>
      </div>
    </div>
  );
}
