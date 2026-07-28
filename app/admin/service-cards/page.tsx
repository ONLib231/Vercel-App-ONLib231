import type { Metadata } from "next";
import { getAllServiceOptionsForAdmin } from "@/lib/super-admin";
import { ServiceOptionsManager } from "@/components/admin/ServiceOptionsManager";

export const metadata: Metadata = {
  title: "Service Cards — Super Admin",
};

export default async function ServiceCardsPage() {
  const serviceOptions = await getAllServiceOptionsForAdmin();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Service Cards</h1>
        <p className="text-sm text-slate-500">The Verta Delivery / ONLib Marketplace cards on the landing screen.</p>
      </div>

      <ServiceOptionsManager serviceOptions={serviceOptions} />
    </div>
  );
}
