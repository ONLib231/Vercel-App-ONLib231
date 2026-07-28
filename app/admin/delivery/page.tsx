import { getDeliveryOrders, getDeliveryAgents } from "@/lib/delivery-admin";
import { DeliveryOrderRow } from "./DeliveryOrderRow";

export default async function DeliveryOrdersAdminPage() {
  const [orders, agents] = await Promise.all([getDeliveryOrders(), getDeliveryAgents()]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Delivery Orders</h1>
      <div className="card overflow-x-auto">
        {orders.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No delivery orders yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2">Sender</th>
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <DeliveryOrderRow key={order.id} order={order} agents={agents} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
