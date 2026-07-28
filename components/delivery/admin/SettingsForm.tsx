"use client";

import { useState, useTransition } from "react";
import { updateDeliverySettings } from "@/lib/actions/delivery";
import type { DeliverySettingsRow } from "@/types/delivery";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface SettingsFormProps {
  settings: DeliverySettingsRow | null;
}

/** Business profile settings — logo upload isn't ported yet (see 0006 migration header), text fields only for now. */
export function SettingsForm({ settings }: SettingsFormProps) {
  const [businessName, setBusinessName] = useState(settings?.business_name ?? "");
  const [businessEmail, setBusinessEmail] = useState(settings?.business_email ?? "");
  const [businessPhone, setBusinessPhone] = useState(settings?.business_phone ?? "");
  const [businessAddress, setBusinessAddress] = useState(settings?.business_address ?? "");
  const [businessDescription, setBusinessDescription] = useState(settings?.business_description ?? "");
  const [openingTime, setOpeningTime] = useState(settings?.opening_time ?? "");
  const [closingTime, setClosingTime] = useState(settings?.closing_time ?? "");
  const [openDays, setOpenDays] = useState<string[]>(settings?.open_days ?? []);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleDay(day: string) {
    setOpenDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateDeliverySettings({
        businessName,
        businessEmail,
        businessPhone,
        businessAddress,
        businessDescription,
        openingTime,
        closingTime,
        openDays,
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn't save settings.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">Business name</label>
        <input
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Business email</label>
          <input
            type="email"
            value={businessEmail}
            onChange={(e) => setBusinessEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Business phone</label>
          <input
            value={businessPhone}
            onChange={(e) => setBusinessPhone(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">Business address</label>
        <input
          value={businessAddress}
          onChange={(e) => setBusinessAddress(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">Description</label>
        <textarea
          value={businessDescription}
          onChange={(e) => setBusinessDescription(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Opening time</label>
          <input
            type="time"
            value={openingTime}
            onChange={(e) => setOpeningTime(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Closing time</label>
          <input
            type="time"
            value={closingTime}
            onChange={(e) => setClosingTime(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">Open days</label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_DAYS.map((day) => (
            <button
              type="button"
              key={day}
              onClick={() => toggleDay(day)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                openDays.includes(day) ? "border-verta-400 bg-verta-50 text-verta-700" : "border-slate-200 text-slate-500"
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-onlib-600">{error}</p>}
      {saved && <p className="text-sm font-medium text-emerald-600">Settings saved.</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-verta-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-verta-700 disabled:opacity-60"
      >
        {isPending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
