import type { Metadata } from "next";
import { getDeliveryPricePresets } from "@/lib/delivery";
import { PricingManager } from "@/components/delivery/admin/PricingManager";

export const metadata: Metadata = {
  title: "Pricing — Delivery Admin",
};

export default async function DeliveryAdminPricingPage() {
  const presets = await getDeliveryPricePresets();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Pricing Presets</h1>
        <p className="text-sm text-slate-500">Quick-select amounts offered when accepting an order.</p>
      </div>

      <PricingManager initialPresets={presets} />
    </div>
  );
}
