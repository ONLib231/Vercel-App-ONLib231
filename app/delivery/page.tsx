import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAuthUser } from "@/lib/user";
import { getMyDeliveryOrders, isDeliveryAdmin } from "@/lib/delivery";
import { DeliveryOrderForm } from "@/components/delivery/DeliveryOrderForm";
import { DeliveryOrdersList } from "@/components/delivery/DeliveryOrdersList";

export const metadata: Metadata = {
  title: "Verta Delivery",
};

/**
 * Sender home for Verta Delivery — the Next.js port of the original app's
 * sender dashboard (see supabase/migrations/0006_create_delivery_module.sql
 * for the full data-model mapping). middleware.ts already requires sign-in
 * for the whole /delivery tree; the only extra routing decision here is
 * "does this signed-in user land on the sender view or the admin one" —
 * same role-based split as the original app's single shared login.
 */
export default async function DeliverySenderPage() {
  const user = await getCurrentAuthUser();
  if (!user) {
    redirect("/login?next=/delivery");
    return null;
  }

  if (await isDeliveryAdmin()) {
    redirect("/delivery/admin");
    return null;
  }

  const orders = await getMyDeliveryOrders();

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-xl font-extrabold text-verta-900">Verta Delivery</h1>
        <p className="text-sm text-slate-500">Send a package, track it in real time.</p>
      </div>

      <DeliveryOrderForm />

      <div>
        <h2 className="mb-2 text-sm font-bold text-slate-700">My Deliveries</h2>
        <DeliveryOrdersList initialOrders={orders} senderId={user.id} />
      </div>
    </div>
  );
}
