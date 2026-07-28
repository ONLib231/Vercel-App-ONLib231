import type { Metadata } from "next";
import { ClipboardList, UserRound } from "lucide-react";
import { getMyStore, getVendorDashboardStats } from "@/lib/vendor";
import { WelcomeBanner } from "@/components/vendor/WelcomeBanner";
import { SalesOverviewChart } from "@/components/vendor/SalesOverviewChart";
import { StatCard } from "@/components/vendor/StatCard";
import { RecentOrdersList } from "@/components/vendor/RecentOrdersList";
import { QuickActionsGrid } from "@/components/vendor/QuickActionsGrid";

export const metadata: Metadata = {
  title: "Vendor Dashboard — ONLib",
};

export default async function VendorDashboardPage() {
  const store = await getMyStore();
  const stats = await getVendorDashboardStats(store?.id ?? "");

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <WelcomeBanner storeName={store?.name ?? "Your Store"} online />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SalesOverviewChart totalLabel={stats.salesLast30Label} changePct={stats.salesChangePct} points={stats.salesTrend} />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <StatCard icon={ClipboardList} label="Total Orders" value={stats.totalOrders} />
          <StatCard icon={UserRound} label="New Leads" value={stats.newLeads} />
        </div>
      </div>

      <RecentOrdersList orders={stats.recentOrders} />
      <QuickActionsGrid />
    </div>
  );
}
