"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createCategoryAction, type CategoryFormState } from "./actions";

const initialState: CategoryFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary sm:w-auto sm:px-6" disabled={pending}>
      {pending ? "Adding…" : "Add category"}
    </button>
  );
}

export function CategoryForm() {
  const [state, formAction] = useFormState(createCategoryAction, initialState);

  return (
    <form action={formAction} className="card grid gap-4 p-5 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <div>
        <label className="label" htmlFor="name">
          Name
        </label>
        <input id="name" name="name" required className="input" placeholder="e.g. Electronics" />
      </div>
      <div>
        <label className="label" htmlFor="icon">
          Icon (emoji, optional)
        </label>
        <input id="icon" name="icon" className="input" placeholder="🖥️" />
      </div>
      <SubmitButton />
      {state.error ? <p className="sm:col-span-3 text-sm text-brand-red">{state.error}</p> : null}
    </form>
  );
}
