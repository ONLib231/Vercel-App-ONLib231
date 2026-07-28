import type { Metadata } from "next";
import { getDeliverySettings } from "@/lib/delivery";
import { SettingsForm } from "@/components/delivery/admin/SettingsForm";

export const metadata: Metadata = {
  title: "Settings — Delivery Admin",
};

export default async function DeliveryAdminSettingsPage() {
  const settings = await getDeliverySettings();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Business Settings</h1>
        <p className="text-sm text-slate-500">Shown to senders as your business profile.</p>
      </div>

      <SettingsForm settings={settings} />
    </div>
  );
}
