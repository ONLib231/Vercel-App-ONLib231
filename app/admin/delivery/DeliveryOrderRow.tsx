"use client";

import { updateDeliveryOrderStatusAction, assignDeliveryAgentAction } from "./actions";
import { formatDate } from "@/lib/utils";
import type { DeliveryOrder, DeliveryAgent } from "@/lib/delivery-admin";

const STATUSES = ["pending", "accepted", "picked_up", "delivered", "cancelled"] as const;

export function DeliveryOrderRow({ order, agents }: { order: DeliveryOrder; agents: DeliveryAgent[] }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-3">
        <p className="font-medium text-slate-800">{order.sender_name}</p>
        <p className="text-xs text-slate-400">{formatDate(order.created_at)}</p>
      </td>
      <td className="px-3 py-3 text-slate-600">
        <p className="truncate">{order.pickup_address}</p>
        <p className="truncate text-slate-400">→ {order.dropoff_address}</p>
      </td>
      <td className="max-w-xs truncate px-3 py-3 text-slate-600">{order.item_description}</td>
      <td className="px-3 py-3">
        <form action={assignDeliveryAgentAction} className="flex items-center">
          <input type="hidden" name="order_id" value={order.id} />
          <select
            name="agent_id"
            defaultValue={order.assigned_agent_id ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">Unassigned</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </form>
      </td>
      <td className="px-3 py-3">
        <form action={updateDeliveryOrderStatusAction} className="flex items-center">
          <input type="hidden" name="order_id" value={order.id} />
          <select
            name="status"
            defaultValue={order.status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs capitalize"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </form>
      </td>
    </tr>
  );
}
