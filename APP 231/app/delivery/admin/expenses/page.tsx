import type { Metadata } from "next";
import { getDeliveryExpenses } from "@/lib/delivery";
import { ExpensesManager } from "@/components/delivery/admin/ExpensesManager";

export const metadata: Metadata = {
  title: "Expenses — Delivery Admin",
};

export default async function DeliveryAdminExpensesPage() {
  const expenses = await getDeliveryExpenses();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Expenses</h1>
        <p className="text-sm text-slate-500">Track fuel, maintenance, and other delivery-side costs.</p>
      </div>

      <ExpensesManager initialExpenses={expenses} />
    </div>
  );
}
