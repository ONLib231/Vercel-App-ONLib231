import { getDeliveryAgents } from "@/lib/delivery-admin";
import { toggleAgentDutyAction, toggleAgentActiveAction } from "./actions";
import { AgentForm } from "./AgentForm";

export default async function DeliveryAgentsPage() {
  const agents = await getDeliveryAgents();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Fleet / Delivery Agents</h1>

      <AgentForm />

      <div className="card divide-y divide-slate-100">
        {agents.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No agents yet.</p>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium text-slate-800">{agent.name}</p>
                <p className="text-sm text-slate-500">{agent.phone}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`badge ${agent.duty_status === "on_duty" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                  {agent.duty_status === "on_duty" ? "On duty" : "Off duty"}
                </span>
                <form action={toggleAgentDutyAction}>
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <input type="hidden" name="duty_status" value={agent.duty_status} />
                  <button type="submit" className="text-xs font-medium text-brand-blue hover:underline">
                    Toggle duty
                  </button>
                </form>
                <form action={toggleAgentActiveAction}>
                  <input type="hidden" name="agent_id" value={agent.id} />
                  <input type="hidden" name="is_active" value={String(agent.is_active)} />
                  <button type="submit" className="text-xs font-medium text-brand-red hover:underline">
                    {agent.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
