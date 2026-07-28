import type { Metadata } from "next";
import { getAllDeliveryOrders, getDeliveryAgents, getDeliveryPricePresets } from "@/lib/delivery";
import { OrdersBoard } from "@/components/delivery/admin/OrdersBoard";

export const metadata: Metadata = {
  title: "Orders — Delivery Admin",
};

export default async function DeliveryAdminOrdersPage() {
  const [orders, agents, pricePresets] = await Promise.all([
    getAllDeliveryOrders(),
    getDeliveryAgents(),
    getDeliveryPricePresets(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Orders</h1>
        <p className="text-sm text-slate-500">Updates live as senders place and cancel orders.</p>
      </div>

      <OrdersBoard initialOrders={orders} agents={agents} pricePresets={pricePresets} />
    </div>
  );
}
