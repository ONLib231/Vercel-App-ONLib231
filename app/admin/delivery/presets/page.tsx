import { getDeliveryPricePresets } from "@/lib/delivery-admin";
import { deletePresetAction } from "./actions";
import { PresetForm } from "./PresetForm";

export default async function DeliveryPresetsPage() {
  const presets = await getDeliveryPricePresets();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Price Presets</h1>

      <PresetForm />

      <div className="card divide-y divide-slate-100">
        {presets.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No presets yet.</p>
        ) : (
          presets.map((preset) => (
            <div key={preset.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium text-slate-800">{preset.label}</p>
                <p className="text-sm text-slate-500">${Number(preset.amount).toFixed(2)}</p>
              </div>
              <form action={deletePresetAction}>
                <input type="hidden" name="preset_id" value={preset.id} />
                <button type="submit" className="text-xs font-medium text-brand-red hover:underline">
                  Remove
                </button>
              </form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
