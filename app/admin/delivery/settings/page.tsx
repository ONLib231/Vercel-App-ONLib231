import { getDeliverySettings } from "@/lib/delivery-admin";
import { SettingsForm } from "./SettingsForm";

export default async function DeliverySettingsPage() {
  const settings = await getDeliverySettings();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Business Settings</h1>
      <p className="text-sm text-slate-500">
        New delivery orders notify this phone (SMS + WhatsApp) and email, in parallel and best-effort — a slow or failing channel never blocks
        the order itself.
      </p>
      <SettingsForm businessPhone={settings?.business_phone ?? ""} businessEmail={settings?.business_email ?? ""} />
    </div>
  );
}
