import { createClient } from "@/lib/supabase/server";
import { formatCents, formatDate } from "@/lib/utils";
import type { Tables } from "@/lib/supabase/database.types";

export default async function AdminOrdersPage() {
  const supabase = await createClient();

  const { data: orders }: { data: Tables<"orders">[] | null } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const storeIds = Array.from(new Set((orders ?? []).map((o) => o.store_id)));
  const { data: stores }: { data: Tables<"stores">[] | null } = storeIds.length
    ? await supabase.from("stores").select("*").in("id", storeIds)
    : { data: [] };
  const storeNameById = new Map((stores ?? []).map((s) => [s.id, s.name]));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Marketplace Orders</h1>
      <div className="card overflow-x-auto">
        {(orders ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No orders yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">Buyer</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((order) => (
                <tr key={order.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-3 font-medium text-slate-800">{storeNameById.get(order.store_id) ?? "—"}</td>
                  <td className="px-3 py-3 text-slate-600">{order.buyer_name}</td>
                  <td className="px-3 py-3 text-slate-800">{formatCents(order.total_cents)}</td>
                  <td className="px-3 py-3">
                    <span className="badge bg-slate-100 text-slate-600 capitalize">{order.status}</span>
                  </td>
                  <td className="px-3 py-3 text-slate-500">{formatDate(order.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
