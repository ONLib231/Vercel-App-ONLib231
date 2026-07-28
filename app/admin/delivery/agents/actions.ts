"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type AgentFormState = { error: string | null };

export async function addAgentAction(_prevState: AgentFormState, formData: FormData): Promise<AgentFormState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!name || !phone) return { error: "Name and phone are required." };

  const supabase = await createClient();
  const { error } = await supabase.from("delivery_agents").insert({ name, phone });
  if (error) return { error: error.message };

  revalidatePath("/admin/delivery/agents");
  return { error: null };
}

export async function toggleAgentDutyAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const agentId = String(formData.get("agent_id") ?? "");
  const dutyStatus = String(formData.get("duty_status") ?? "");
  if (!agentId) return;

  const supabase = await createClient();
  await supabase
    .from("delivery_agents")
    .update({ duty_status: dutyStatus === "on_duty" ? "off_duty" : "on_duty" })
    .eq("id", agentId);

  revalidatePath("/admin/delivery/agents");
}

export async function toggleAgentActiveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const agentId = String(formData.get("agent_id") ?? "");
  const isActive = formData.get("is_active") === "true";
  if (!agentId) return;

  const supabase = await createClient();
  await supabase.from("delivery_agents").update({ is_active: !isActive }).eq("id", agentId);

  revalidatePath("/admin/delivery/agents");
}
