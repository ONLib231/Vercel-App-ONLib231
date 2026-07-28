"use client";

import { useState, useTransition } from "react";
import { Phone, Plus, UserRound } from "lucide-react";
import { createDeliveryAgent, setDeliveryAgentDutyStatus } from "@/lib/actions/delivery";
import type { DeliveryAgentRow } from "@/types/delivery";

export interface FleetManagerProps {
  initialAgents: DeliveryAgentRow[];
}

/** Fleet Directory — admin-managed roster of delivery agents (NOT login accounts, same as the original app). */
export function FleetManager({ initialAgents }: FleetManagerProps) {
  const [agents, setAgents] = useState(initialAgents);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createDeliveryAgent(name, phone);
      if (!result.ok) {
        setError(result.error ?? "Couldn't add this agent.");
        return;
      }
      setAgents((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), duty_status: "off_duty", created_at: new Date().toISOString() },
      ]);
      setName("");
      setPhone("");
    });
  }

  function handleToggleDuty(agent: DeliveryAgentRow) {
    const nextStatus = agent.duty_status === "on_duty" ? "off_duty" : "on_duty";
    setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, duty_status: nextStatus } : a)));
    startTransition(async () => {
      await setDeliveryAgentDutyStatus(agent.id, nextStatus);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Agent name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="e.g. James Kollie"
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="+231…"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-full bg-verta-600 px-4 py-2 text-sm font-semibold text-white hover:bg-verta-700 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add agent
        </button>
      </form>

      {error && <p className="text-sm text-onlib-600">{error}</p>}

      <ul className="space-y-2">
        {agents.map((agent) => (
          <li key={agent.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-verta-50 text-verta-700">
                <UserRound className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">{agent.name}</p>
                <p className="flex items-center gap-1 text-xs text-slate-400">
                  <Phone className="h-3 w-3" aria-hidden />
                  {agent.phone}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleToggleDuty(agent)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                agent.duty_status === "on_duty" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {agent.duty_status === "on_duty" ? "On duty" : "Off duty"}
            </button>
          </li>
        ))}
        {agents.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No agents yet — add your first one above.</p>}
      </ul>
    </div>
  );
}
