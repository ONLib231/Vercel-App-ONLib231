"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { deleteExpenseAction, type DeleteExpenseState } from "./actions";

const initialState: DeleteExpenseState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-danger px-3 py-1.5 text-xs" disabled={pending}>
      {pending ? "Deleting…" : "Confirm delete"}
    </button>
  );
}

export function DeleteExpenseButton({ expenseId }: { expenseId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(deleteExpenseAction, initialState);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-brand-red hover:underline">
        Delete
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="expense_id" value={expenseId} />
      <input type="password" name="password" placeholder="Delete password" required className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
      <SubmitButton />
      {state.error ? <span className="text-xs text-brand-red">{state.error}</span> : null}
    </form>
  );
}
