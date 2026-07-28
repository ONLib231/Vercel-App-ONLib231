"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createDeliveryExpense, deleteDeliveryExpense } from "@/lib/actions/delivery";
import type { DeliveryExpenseRow } from "@/types/delivery";

export interface ExpensesManagerProps {
  initialExpenses: DeliveryExpenseRow[];
}

export function ExpensesManager({ initialExpenses }: ExpensesManagerProps) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [isPending, startTransition] = useTransition();

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createDeliveryExpense(new Date(date).toISOString(), Number(amount), description);
      if (!result.ok) {
        setError(result.error ?? "Couldn't add this expense.");
        return;
      }
      setExpenses((prev) => [
        { id: crypto.randomUUID(), expense_date: new Date(date).toISOString(), amount: Number(amount), description, created_at: new Date().toISOString() },
        ...prev,
      ]);
      setAmount("");
      setDescription("");
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteDeliveryExpense(id, deletePassword);
      if (!result.ok) {
        setError(result.error ?? "Couldn't delete this expense.");
        return;
      }
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      setDeletingId(null);
      setDeletePassword("");
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <p className="text-xs text-slate-400">Total expenses</p>
        <p className="text-xl font-bold text-slate-800">
          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)}
        </p>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="e.g. Fuel for agents"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-full bg-verta-600 px-4 py-2 text-sm font-semibold text-white hover:bg-verta-700 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add
        </button>
      </form>

      {error && <p className="text-sm text-onlib-600">{error}</p>}

      <ul className="space-y-2">
        {expenses.map((expense) => (
          <li key={expense.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-slate-800">{expense.description}</p>
              <p className="text-xs text-slate-400">{new Date(expense.expense_date).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-700">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(expense.amount))}
              </span>
              {deletingId === expense.id ? (
                <span className="flex items-center gap-1">
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Password"
                    className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  />
                  <button onClick={() => handleDelete(expense.id)} className="text-xs font-semibold text-onlib-600">
                    Confirm
                  </button>
                </span>
              ) : (
                <button onClick={() => setDeletingId(expense.id)} className="text-slate-400 hover:text-onlib-600">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </li>
        ))}
        {expenses.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No expenses recorded yet.</p>}
      </ul>
    </div>
  );
}
