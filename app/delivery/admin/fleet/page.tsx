import type { Metadata } from "next";
import { getDeliveryAgents } from "@/lib/delivery";
import { FleetManager } from "@/components/delivery/admin/FleetManager";

export const metadata: Metadata = {
  title: "Fleet — Delivery Admin",
};

export default async function DeliveryAdminFleetPage() {
  const agents = await getDeliveryAgents();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Fleet Directory</h1>
        <p className="text-sm text-slate-500">Agents are a contact roster, not login accounts — assign them when accepting an order.</p>
      </div>

      <FleetManager initialAgents={agents} />
    </div>
  );
}
