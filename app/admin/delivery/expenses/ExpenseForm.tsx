"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addExpenseAction, type ExpenseFormState } from "./actions";

const initialState: ExpenseFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary sm:w-auto sm:px-6" disabled={pending}>
      {pending ? "Adding…" : "Add expense"}
    </button>
  );
}

export function ExpenseForm() {
  const [state, formAction] = useFormState(addExpenseAction, initialState);

  return (
    <form action={formAction} className="card grid gap-4 p-5 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end">
      <div>
        <label className="label" htmlFor="amount">
          Amount (USD)
        </label>
        <input id="amount" name="amount" type="number" min="0" step="0.01" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="description">
          Description
        </label>
        <input id="description" name="description" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="expense_date">
          Date
        </label>
        <input id="expense_date" name="expense_date" type="date" className="input" />
      </div>
      <SubmitButton />
      {state.error ? <p className="sm:col-span-4 text-sm text-brand-red">{state.error}</p> : null}
    </form>
  );
}
