"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ExpenseFormState = { error: string | null };

export async function addExpenseAction(_prevState: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const profile = await requireAdmin();
  const amount = Number(formData.get("amount") ?? 0);
  const description = String(formData.get("description") ?? "").trim();
  const expenseDate = String(formData.get("expense_date") ?? "") || undefined;

  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid amount." };

  const supabase = await createClient();
  const { error } = await supabase.from("delivery_expenses").insert({
    amount,
    description: description || null,
    expense_date: expenseDate,
    created_by: profile.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/delivery/expenses");
  return { error: null };
}

export type DeleteExpenseState = { error: string | null };

// Guarded by DELIVERY_DELETE_PASSWORD so an accidental click can't wipe
// financial history — the admin must re-enter the shared delete password.
export async function deleteExpenseAction(_prevState: DeleteExpenseState, formData: FormData): Promise<DeleteExpenseState> {
  await requireAdmin();
  const expenseId = String(formData.get("expense_id") ?? "");
  const password = String(formData.get("password") ?? "");

  const expectedPassword = process.env.DELIVERY_DELETE_PASSWORD;
  if (!expectedPassword) {
    return { error: "DELIVERY_DELETE_PASSWORD is not configured on the server." };
  }
  if (password !== expectedPassword) {
    return { error: "Incorrect delete password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("delivery_expenses").delete().eq("id", expenseId);
  if (error) return { error: error.message };

  revalidatePath("/admin/delivery/expenses");
  return { error: null };
}
