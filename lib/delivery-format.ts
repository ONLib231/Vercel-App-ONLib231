import type { DeliveryOrderStatus } from "@/types/delivery";

/**
 * Pure, client-safe formatting helpers for Delivery orders — split out of
 * lib/delivery.ts on purpose. That file's top-level `import ... from
 * "@/lib/supabase/server"` pulls in `next/headers`, which only works inside
 * a Server Component/Action; two client components (DeliveryOrdersList,
 * OrdersBoard) need these three functions just for display formatting, and
 * importing them from lib/delivery.ts directly was dragging the whole
 * next/headers-importing module into the client bundle, which Next.js
 * refuses to build ("You're importing a component that needs next/headers").
 * This file has zero server-only imports, so it's safe from either side.
 */

export function formatMoney(amount: number | null): string | null {
  if (amount === null || amount === undefined) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function statusLabelFor(status: DeliveryOrderStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "picked_up":
      return "Picked Up";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
  }
}

/** "#A1B2C3" from a uuid — same short-code convention as ONLib order numbers (lib/vendor.ts). */
export function orderCodeFor(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
