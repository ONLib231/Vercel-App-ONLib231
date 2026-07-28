"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateServiceOption } from "@/lib/actions/super-admin";
import type { ServiceOptionRow } from "@/types/service";

export interface ServiceOptionsManagerProps {
  serviceOptions: ServiceOptionRow[];
}

export function ServiceOptionsManager({ serviceOptions }: ServiceOptionsManagerProps) {
  return (
    <div className="space-y-4">
      {serviceOptions.map((option) => (
        <ServiceOptionCard key={option.id} option={option} />
      ))}
    </div>
  );
}

function ServiceOptionCard({ option }: { option: ServiceOptionRow }) {
  const router = useRouter();
  const [title, setTitle] = useState(option.title);
  const [subtitle, setSubtitle] = useState(option.subtitle);
  const [badgeLabel, setBadgeLabel] = useState(option.badge_label);
  const [badgeIcon, setBadgeIcon] = useState(option.badge_icon);
  const [accent, setAccent] = useState(option.accent);
  const [route, setRoute] = useState(option.route);
  const [isActive, setIsActive] = useState(option.is_active);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateServiceOption({
        id: option.id,
        title,
        subtitle,
        badgeLabel,
        badgeIcon,
        accent,
        route,
        sortOrder: option.sort_order,
        isActive,
      });
      if (!result.ok) {
        setError(result.error ?? "Couldn't save this service card.");
        return;
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{option.key}</p>
        <button
          type="button"
          onClick={() => setIsActive((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
        >
          {isActive ? "Active" : "Hidden"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Route</label>
          <input value={route} onChange={(e) => setRoute(e.target.value)} required className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-500">Subtitle</label>
        <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} required className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Badge label</label>
          <input value={badgeLabel} onChange={(e) => setBadgeLabel(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Badge icon</label>
          <select value={badgeIcon} onChange={(e) => setBadgeIcon(e.target.value as typeof badgeIcon)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="zap">zap</option>
            <option value="tag">tag</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Accent</label>
          <select value={accent} onChange={(e) => setAccent(e.target.value as typeof accent)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="verta">verta</option>
            <option value="onlib">onlib</option>
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-onlib-600">{error}</p>}
      {saved && <p className="text-sm font-medium text-emerald-600">Saved.</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-verta-600 px-5 py-2 text-sm font-semibold text-white hover:bg-verta-700 disabled:opacity-60"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
