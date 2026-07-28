"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addPresetAction, type PresetFormState } from "./actions";

const initialState: PresetFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary sm:w-auto sm:px-6" disabled={pending}>
      {pending ? "Adding…" : "Add preset"}
    </button>
  );
}

export function PresetForm() {
  const [state, formAction] = useFormState(addPresetAction, initialState);

  return (
    <form action={formAction} className="card grid gap-4 p-5 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
      <div>
        <label className="label" htmlFor="label">
          Label
        </label>
        <input id="label" name="label" required className="input" placeholder="e.g. Same-city, standard" />
      </div>
      <div>
        <label className="label" htmlFor="amount">
          Amount (USD)
        </label>
        <input id="amount" name="amount" type="number" min="0" step="0.01" required className="input" />
      </div>
      <SubmitButton />
      {state.error ? <p className="sm:col-span-3 text-sm text-brand-red">{state.error}</p> : null}
    </form>
  );
}
