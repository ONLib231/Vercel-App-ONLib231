import type { Metadata } from "next";
import { getAllMarketplaceOrders } from "@/lib/super-admin";
import { getAllDeliveryOrders } from "@/lib/delivery";

export const metadata: Metadata = {
  title: "Orders Overview — Super Admin",
};

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export default async function OrdersOverviewPage() {
  const [marketplaceOrders, deliveryOrders] = await Promise.all([getAllMarketplaceOrders(), getAllDeliveryOrders()]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Orders Overview</h1>
        <p className="text-sm text-slate-500">Read-only, platform-wide. Most recent 200 Marketplace orders shown.</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-700">Marketplace ({marketplaceOrders.length})</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5">Store</th>
                <th className="px-4 py-2.5">Buyer</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Total</th>
                <th className="px-4 py-2.5">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {marketplaceOrders.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-700">#{order.id.replace(/-/g, "").slice(0, 6).toUpperCase()}</td>
                  <td className="px-4 py-2.5 text-slate-600">{order.storeName ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-600">{order.buyer_name}</td>
                  <td className="px-4 py-2.5 capitalize text-slate-600">{order.status}</td>
                  <td className="px-4 py-2.5 text-slate-600">{formatCents(order.total_cents, order.currency)}</td>
                  <td className="px-4 py-2.5 text-slate-400">{new Date(order.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {marketplaceOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No Marketplace orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-700">Delivery ({deliveryOrders.length})</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5">Sender</th>
                <th className="px-4 py-2.5">Route</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Amount</th>
                <th className="px-4 py-2.5">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {deliveryOrders.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-700">{order.orderCode}</td>
                  <td className="px-4 py-2.5 text-slate-600">{order.senderName}</td>
                  <td className="px-4 py-2.5 max-w-xs truncate text-slate-600">
                    {order.pickupAddress} → {order.dropoffAddress}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{order.statusLabel}</td>
                  <td className="px-4 py-2.5 text-slate-600">{order.amountLabel ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-400">{order.createdAtLabel}</td>
                </tr>
              ))}
              {deliveryOrders.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No Delivery orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
