import { getDeliveryExpenses } from "@/lib/delivery-admin";
import { formatDate } from "@/lib/utils";
import { ExpenseForm } from "./ExpenseForm";
import { DeleteExpenseButton } from "./DeleteExpenseButton";

export default async function DeliveryExpensesPage() {
  const expenses = await getDeliveryExpenses();
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Delivery Expenses</h1>

      <ExpenseForm />

      <div className="card p-5">
        <p className="text-sm text-slate-500">Total tracked</p>
        <p className="text-2xl font-bold text-slate-900">${total.toFixed(2)}</p>
      </div>

      <div className="card divide-y divide-slate-100">
        {expenses.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No expenses logged yet.</p>
        ) : (
          expenses.map((expense) => (
            <div key={expense.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium text-slate-800">${Number(expense.amount).toFixed(2)}</p>
                <p className="text-sm text-slate-500">{expense.description || "—"}</p>
                <p className="text-xs text-slate-400">{formatDate(expense.expense_date)}</p>
              </div>
              <DeleteExpenseButton expenseId={expense.id} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
