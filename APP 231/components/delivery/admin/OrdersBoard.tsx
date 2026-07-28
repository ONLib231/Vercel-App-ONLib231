"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { orderCodeFor, statusLabelFor } from "@/lib/delivery-format";
import { acceptDeliveryOrder, deleteDeliveryOrders, updateDeliveryOrder } from "@/lib/actions/delivery";
import { StatusBadge } from "@/components/delivery/StatusBadge";
import type { DeliveryAgentRow, DeliveryOrderRow, DeliveryOrderStatus, DeliveryOrderViewModel, DeliveryPricePresetRow } from "@/types/delivery";

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

const COLUMNS: { status: DeliveryOrderStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "accepted", label: "Accepted" },
  { status: "picked_up", label: "Picked Up" },
  { status: "delivered", label: "Delivered" },
  { status: "cancelled", label: "Cancelled" },
];

const NEXT_STATUS: Partial<Record<DeliveryOrderStatus, DeliveryOrderStatus>> = {
  accepted: "picked_up",
  picked_up: "delivered",
};

export interface OrdersBoardProps {
  initialOrders: DeliveryOrderViewModel[];
  agents: DeliveryAgentRow[];
  pricePresets: DeliveryPricePresetRow[];
}

export function OrdersBoard({ initialOrders, agents, pricePresets }: OrdersBoardProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("delivery_orders:admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "delivery_orders" },
        (payload) => {
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const updated = toViewModel(payload.new as DeliveryOrderRow);
            setOrders((prev) => {
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
  }, []);

  const onDutyAgents = useMemo(() => agents.filter((a) => a.duty_status === "on_duty"), [agents]);
  const acceptingOrder = orders.find((o) => o.id === acceptingOrderId) ?? null;

  function handleAdvance(orderId: string, status: DeliveryOrderStatus) {
    startTransition(async () => {
      const result = await updateDeliveryOrder({ orderId, status });
      if (!result.ok) setError(result.error ?? "Couldn't update this order.");
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkDelete() {
    startTransition(async () => {
      const result = await deleteDeliveryOrders(Array.from(selectedIds), deletePassword);
      if (!result.ok) {
        setError(result.error ?? "Couldn't delete these orders.");
        return;
      }
      setSelectedIds(new Set());
      setDeletePassword("");
      setShowDeleteConfirm(false);
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg bg-onlib-50 px-3 py-2 text-sm text-onlib-700">
          {error}{" "}
          <button onClick={() => setError(null)} className="font-semibold underline">
            Dismiss
          </button>
        </p>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-2.5 shadow-sm">
          <p className="text-sm font-medium text-slate-600">{selectedIds.size} order(s) selected</p>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-full bg-onlib-50 px-3 py-1.5 text-xs font-semibold text-onlib-700 hover:bg-onlib-100"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete selected
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const columnOrders = orders.filter((o) => o.status === col.status);
          return (
            <div key={col.status} className="space-y-2">
              <h3 className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                {col.label}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{columnOrders.length}</span>
              </h3>
              <div className="space-y-2">
                {columnOrders.map((order) => (
                  <div key={order.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(order.id)}
                        onChange={() => toggleSelected(order.id)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300"
                        aria-label={`Select order ${order.orderCode}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900">{order.orderCode}</p>
                        <p className="truncate text-xs text-slate-500">{order.senderName}</p>
                        <p className="mt-1 truncate text-xs text-slate-400">{order.pickupAddress} → {order.dropoffAddress}</p>
                        {order.amountLabel && <p className="mt-1 text-xs font-semibold text-slate-700">{order.amountLabel}</p>}
                        {order.acceptedBy && <p className="text-[11px] text-slate-400">Agent: {order.acceptedBy}</p>}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <StatusBadge status={order.status} label={order.statusLabel} />
                      {order.status === "pending" && (
                        <button
                          onClick={() => setAcceptingOrderId(order.id)}
                          className="rounded-full bg-verta-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-verta-700"
                        >
                          Accept
                        </button>
                      )}
                      {NEXT_STATUS[order.status] && (
                        <button
                          onClick={() => handleAdvance(order.id, NEXT_STATUS[order.status]!)}
                          disabled={isPending}
                          className="rounded-full border border-verta-100 px-3 py-1 text-[11px] font-semibold text-verta-700 hover:bg-verta-50 disabled:opacity-60"
                        >
                          Mark {statusLabelFor(NEXT_STATUS[order.status]!)}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {columnOrders.length === 0 && <p className="text-xs text-slate-300">Nothing here</p>}
              </div>
            </div>
          );
        })}
      </div>

      {acceptingOrder && (
        <AcceptOrderDialog
          order={acceptingOrder}
          agents={onDutyAgents}
          pricePresets={pricePresets}
          onClose={() => setAcceptingOrderId(null)}
          onError={setError}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">Confirm delete</h3>
            <p className="mt-1 text-sm text-slate-500">Enter the delete password to permanently remove {selectedIds.size} order(s).</p>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Delete password"
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-full border border-slate-200 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={isPending || !deletePassword}
                className="flex-1 rounded-full bg-onlib-600 py-2 text-sm font-semibold text-white hover:bg-onlib-700 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AcceptOrderDialog({
  order,
  agents,
  pricePresets,
  onClose,
  onError,
}: {
  order: DeliveryOrderViewModel;
  agents: DeliveryAgentRow[];
  pricePresets: DeliveryPricePresetRow[];
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [acceptedBy, setAcceptedBy] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await acceptDeliveryOrder({
        orderId: order.id,
        amount: Number(amount),
        acceptedBy,
        paymentMethod,
      });
      if (!result.ok) {
        onError(result.error ?? "Couldn't accept this order.");
        return;
      }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-slate-900">Accept {order.orderCode}</h3>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Assign agent</label>
          <select
            value={acceptedBy}
            onChange={(e) => setAcceptedBy(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select an on-duty agent
            </option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.name}>
                {agent.name} — {agent.phone}
              </option>
            ))}
          </select>
          {agents.length === 0 && <p className="mt-1 text-xs text-onlib-600">No agents are on duty — add one in Fleet first.</p>}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="0.00"
          />
          {pricePresets.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {pricePresets.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  onClick={() => setAmount(String(preset.amount))}
                  className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  {preset.label} — ${preset.amount}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Payment method</label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="cash">Cash</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="card">Card</option>
          </select>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-slate-200 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 rounded-full bg-verta-600 py-2 text-sm font-semibold text-white hover:bg-verta-700 disabled:opacity-60"
          >
            {isPending ? "Accepting…" : "Accept order"}
          </button>
        </div>
      </form>
    </div>
  );
}
