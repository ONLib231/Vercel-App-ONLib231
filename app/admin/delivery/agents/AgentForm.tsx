"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addAgentAction, type AgentFormState } from "./actions";

const initialState: AgentFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary sm:w-auto sm:px-6" disabled={pending}>
      {pending ? "Adding…" : "Add agent"}
    </button>
  );
}

export function AgentForm() {
  const [state, formAction] = useFormState(addAgentAction, initialState);

  return (
    <form action={formAction} className="card grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div>
        <label className="label" htmlFor="name">
          Agent name
        </label>
        <input id="name" name="name" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="phone">
          Phone
        </label>
        <input id="phone" name="phone" required className="input" />
      </div>
      <SubmitButton />
      {state.error ? <p className="sm:col-span-3 text-sm text-brand-red">{state.error}</p> : null}
    </form>
  );
}
