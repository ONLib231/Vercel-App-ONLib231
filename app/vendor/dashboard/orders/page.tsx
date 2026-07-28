import { requireApprovedVendor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCents, formatDate } from "@/lib/utils";
import { OrderStatusSelect } from "./OrderStatusSelect";
import type { Tables } from "@/lib/supabase/database.types";

export default async function VendorOrdersPage() {
  const { store } = await requireApprovedVendor();
  const supabase = await createClient();

  const { data: orders }: { data: Tables<"orders">[] | null } = await supabase
    .from("orders")
    .select("*")
    .eq("store_id", store.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Orders</h1>
      <div className="card divide-y divide-slate-100">
        {!orders || orders.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No orders yet.</p>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium text-slate-800">Order #{order.id.slice(0, 8)}</p>
                <p className="text-xs text-slate-400">
                  {order.buyer_name} · {formatDate(order.created_at)}
                </p>
              </div>
              <span className="font-semibold text-slate-800">{formatCents(order.total_cents)}</span>
              <OrderStatusSelect orderId={order.id} status={order.status} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
