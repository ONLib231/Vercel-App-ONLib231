import { requireApprovedVendor } from "@/lib/auth";
import { getStoreSalesSummary, getRecentStoreOrders } from "@/lib/vendor-dashboard";
import { formatCents, formatDate } from "@/lib/utils";

export default async function VendorDashboardPage() {
  const { store } = await requireApprovedVendor();
  const [summary, recentOrders] = await Promise.all([getStoreSalesSummary(store.id), getRecentStoreOrders(store.id)]);

  const maxTrend = Math.max(...summary.trend.map((t) => t.totalCents), 1);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between rounded-2xl bg-brand-navy px-6 py-5 text-white">
        <div>
          <p className="text-sm text-slate-300">Welcome back,</p>
          <p className="text-xl font-bold">{store.name}</p>
        </div>
        <span className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-semibold text-green-300">● Online</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-500">Sales Overview (Last 30 Days)</p>
          </div>
          <p className="text-3xl font-bold text-slate-900">{formatCents(summary.totalCents)}</p>
          <div className="mt-4 flex items-end gap-2" style={{ height: 80 }}>
            {summary.trend.map((point) => (
              <div key={point.date} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-brand-blue/70"
                  style={{ height: `${Math.max(4, (point.totalCents / maxTrend) * 70)}px` }}
                  title={formatCents(point.totalCents)}
                />
                <span className="text-[10px] text-slate-400">{point.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <p className="text-sm font-medium text-slate-500">Total Orders</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{summary.orderCount}</p>
          </div>
        </div>
      </div>

      <div className="card mt-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Recent Orders</h2>
        </div>
        {recentOrders.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No orders yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Order #{order.id.slice(0, 8)}</p>
                  <p className="text-xs text-slate-400">
                    {order.buyer_name} · {formatDate(order.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={order.status} />
                  <span className="font-semibold text-slate-800">{formatCents(order.total_cents)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    processing: "bg-blue-100 text-blue-700",
    fulfilled: "bg-green-100 text-green-700",
    cancelled: "bg-slate-200 text-slate-500",
  };
  return <span className={`badge ${styles[status] ?? "bg-slate-100 text-slate-600"}`}>{status}</span>;
}
