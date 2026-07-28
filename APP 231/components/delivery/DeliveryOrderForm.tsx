"use client";

import { useState, useTransition } from "react";
import { PackagePlus } from "lucide-react";
import { createDeliveryOrder } from "@/lib/actions/delivery";

/** "Send a Package" form on the sender's /delivery home — the Next.js port of the original app's "New Order" screen. */
export function DeliveryOrderForm() {
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await createDeliveryOrder({ pickupAddress, dropoffAddress, itemDescription });
      if (!result.ok) {
        setError(result.error ?? "Couldn't place your order. Please try again.");
        return;
      }
      setPickupAddress("");
      setDropoffAddress("");
      setItemDescription("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-verta-50 text-verta-700">
          <PackagePlus className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <h2 className="text-base font-bold text-slate-900">Send a Package</h2>
      </div>

      <div>
        <label htmlFor="pickup" className="mb-1 block text-xs font-semibold text-slate-500">
          Pickup address
        </label>
        <input
          id="pickup"
          value={pickupAddress}
          onChange={(e) => setPickupAddress(e.target.value)}
          required
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-verta-400 focus:outline-none focus:ring-1 focus:ring-verta-400"
          placeholder="Where should the agent pick this up?"
        />
      </div>

      <div>
        <label htmlFor="dropoff" className="mb-1 block text-xs font-semibold text-slate-500">
          Dropoff address
        </label>
        <input
          id="dropoff"
          value={dropoffAddress}
          onChange={(e) => setDropoffAddress(e.target.value)}
          required
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-verta-400 focus:outline-none focus:ring-1 focus:ring-verta-400"
          placeholder="Where's it going?"
        />
      </div>

      <div>
        <label htmlFor="item" className="mb-1 block text-xs font-semibold text-slate-500">
          Item description
        </label>
        <textarea
          id="item"
          value={itemDescription}
          onChange={(e) => setItemDescription(e.target.value)}
          required
          rows={2}
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-verta-400 focus:outline-none focus:ring-1 focus:ring-verta-400"
          placeholder="What are we sending?"
        />
      </div>

      {error && <p className="text-sm text-onlib-600">{error}</p>}
      {success && <p className="text-sm font-medium text-emerald-600">Order placed — an admin will accept it shortly.</p>}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-full bg-verta-600 py-2.5 text-sm font-semibold text-white transition hover:bg-verta-700 disabled:opacity-60"
      >
        {isPending ? "Placing order…" : "Place Delivery Order"}
      </button>
    </form>
  );
}
