"use client";

import { updateOrderStatusAction } from "./actions";

const STATUSES = ["pending", "processing", "fulfilled", "cancelled"] as const;

export function OrderStatusSelect({ orderId, status }: { orderId: string; status: string }) {
  return (
    <form action={updateOrderStatusAction} className="flex items-center gap-2">
      <input type="hidden" name="order_id" value={orderId} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </form>
  );
}
