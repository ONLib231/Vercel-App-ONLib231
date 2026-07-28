"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createDeliveryPricePreset, deleteDeliveryPricePreset } from "@/lib/actions/delivery";
import type { DeliveryPricePresetRow } from "@/types/delivery";

export interface PricingManagerProps {
  initialPresets: DeliveryPricePresetRow[];
}

/** Quick-select price presets offered in the admin's Accept Order dialog. */
export function PricingManager({ initialPresets }: PricingManagerProps) {
  const [presets, setPresets] = useState(initialPresets);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createDeliveryPricePreset(label, Number(amount));
      if (!result.ok) {
        setError(result.error ?? "Couldn't save this price preset.");
        return;
      }
      setPresets((prev) => [...prev, { id: crypto.randomUUID(), label, amount: Number(amount), created_at: new Date().toISOString() }]);
      setLabel("");
      setAmount("");
    });
  }

  function handleDelete(id: string) {
    setPresets((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => {
      await deleteDeliveryPricePreset(id);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="e.g. Within Monrovia"
          />
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-full bg-verta-600 px-4 py-2 text-sm font-semibold text-white hover:bg-verta-700 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add preset
        </button>
      </form>

      {error && <p className="text-sm text-onlib-600">{error}</p>}

      <ul className="space-y-2">
        {presets.map((preset) => (
          <li key={preset.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">{preset.label}</p>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-700">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(preset.amount))}
              </span>
              <button onClick={() => handleDelete(preset.id)} className="text-slate-400 hover:text-onlib-600">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </li>
        ))}
        {presets.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No price presets yet — add one above.</p>}
      </ul>
    </div>
  );
}
