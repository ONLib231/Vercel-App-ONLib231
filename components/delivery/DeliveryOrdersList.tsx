"use client";

import { useEffect, useState, useTransition } from "react";
import { PackageSearch } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cancelDeliveryOrder } from "@/lib/actions/delivery";
import { orderCodeFor, statusLabelFor } from "@/lib/delivery";
import { StatusBadge } from "@/components/delivery/StatusBadge";
import type { DeliveryOrderRow, DeliveryOrderViewModel } from "@/types/delivery";

function toViewModel(row: DeliveryOrderRow): DeliveryOrderViewModel {
  return {
    id: row.id,
    orderCode: orderCodeFor(row.id),
    senderName: row.sender_name,
    pickupAddress: row.pickup_address,
    dropoffAddress: row.dropoff_address,
    itemDescription: row.item_description,
    amountLabel:
      row.amount === null || row.amount === undefined
        ? null
        : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(row.amount),
    status: row.status,
    statusLabel: statusLabelFor(row.status),
    acceptedBy: row.accepted_by,
    paymentMethod: row.payment_method,
    createdAtLabel: new Date(row.created_at).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

export interface DeliveryOrdersListProps {
  initialOrders: DeliveryOrderViewModel[];
  senderId: string;
}

/**
 * Live-updating list of the signed-in sender's own delivery orders.
 * Subscribes to Postgres Changes on delivery_orders filtered to this
 * sender's rows — RLS makes that filter redundant for security (a sender's
 * session literally cannot see anyone else's rows) but it's still applied
 * client-side so this component doesn't have to reason about it.
 *
 * This is the direct replacement for the original app's
 * `socket.on('order:created'/'order:updated'/'order:deleted', ...)` handlers
 * — same real-time effect, no separate Socket.io server to run.
 */
export function DeliveryOrdersList({ initialOrders, senderId }: DeliveryOrdersListProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [isPending, startTransition] = useTransition();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`delivery_orders:sender:${senderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_orders", filter: `sender_id=eq.${senderId}` },
        (payload) => {
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const updated = toViewModel(payload.new as DeliveryOrderRow);
            setOrders((prev) => {
              // Newly created orders belong at the top; an updated order
              // (status change etc.) keeps its existing position rather
              // than jumping to the top, so the list doesn't reshuffle
              // every time an admin advances its status.
              const existingIndex = prev.findIndex((o) => o.id === updated.id);
              if (existingIndex === -1) return [updated, ...prev];
              const next = [...prev];
              next[existingIndex] = updated;
              return next;
            });
          } else if (payload.eventType === "DELETE") {
            const deletedId = (payload.old as Partial<DeliveryOrderRow>).id;
            setOrders((prev) => prev.filter((o) => o.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [senderId]);

  function handleCancel(orderId: string) {
    setCancellingId(orderId);
    startTransition(async () => {
      await cancelDeliveryOrder(orderId);
      setCancellingId(null);
    });
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 py-10 text-center text-slate-400">
        <PackageSearch className="h-8 w-8" aria-hidden />
        <p className="text-sm">No delivery orders yet — place one above.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((order) => (
        <li key={order.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">{order.orderCode}</p>
              <p className="text-xs text-slate-400">{order.createdAtLabel}</p>
            </div>
            <StatusBadge status={order.status} label={order.statusLabel} />
          </div>

          <div className="mt-3 space-y-1 text-sm text-slate-600">
            <p>
              <span className="font-medium text-slate-500">From:</span> {order.pickupAddress}
            </p>
            <p>
              <span className="font-medium text-slate-500">To:</span> {order.dropoffAddress}
            </p>
            <p>
              <span className="font-medium text-slate-500">Item:</span> {order.itemDescription}
            </p>
            {order.acceptedBy && (
              <p>
                <span className="font-medium text-slate-500">Agent:</span> {order.acceptedBy}
              </p>
            )}
            {order.amountLabel && (
              <p>
                <span className="font-medium text-slate-500">Amount:</span> {order.amountLabel}
              </p>
            )}
          </div>

          {order.status === "pending" && (
            <button
              onClick={() => handleCancel(order.id)}
              disabled={isPending && cancellingId === order.id}
              className="mt-3 text-xs font-semibold text-onlib-600 hover:text-onlib-700 disabled:opacity-60"
            >
              {isPending && cancellingId === order.id ? "Cancelling…" : "Cancel order"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
