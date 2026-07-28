import Link from "next/link";
import { ChevronRight, ShoppingBag } from "lucide-react";
import type { OrderViewModel } from "@/types/vendor";

export interface RecentOrdersListProps {
  orders: OrderViewModel[];
}

function statusPillClass(status: OrderViewModel["status"]): string {
  if (status === "fulfilled") return "bg-emerald-50 text-emerald-700";
  if (status === "cancelled") return "bg-onlib-50 text-onlib-700";
  return "bg-verta-50 text-verta-700";
}

/** "Recent Orders" card on the Vendor Dashboard home. */
export function RecentOrdersList({ orders }: RecentOrdersListProps) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">Recent Orders</p>
        <Link href="/vendor/orders" className="text-sm font-medium text-verta-600 hover:text-verta-700">
          View All
        </Link>
      </div>

      {orders.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No orders yet — they'll show up here once customers start buying.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/vendor/orders/${order.id}`}
                className="flex items-center justify-between gap-3 py-3 transition hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-onlib-50 text-onlib-600">
                    <ShoppingBag className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Order {order.orderNumber}</p>
                    <p className="text-xs text-slate-400">Buyer: {order.buyerName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusPillClass(order.status)}`}>
                    {order.statusLabel}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{order.totalLabel}</span>
                  <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
