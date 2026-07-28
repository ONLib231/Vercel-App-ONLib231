"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateDeliverySettingsAction, type SettingsFormState } from "./actions";

const initialState: SettingsFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary sm:w-auto sm:px-6" disabled={pending}>
      {pending ? "Saving…" : "Save settings"}
    </button>
  );
}

export function SettingsForm({ businessPhone, businessEmail }: { businessPhone: string; businessEmail: string }) {
  const [state, formAction] = useFormState(updateDeliverySettingsAction, initialState);

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div>
        <label className="label" htmlFor="business_phone">
          Business phone (SMS + WhatsApp notifications)
        </label>
        <input id="business_phone" name="business_phone" defaultValue={businessPhone} className="input" placeholder="+15551234567" />
      </div>
      <div>
        <label className="label" htmlFor="business_email">
          Business email (email notifications)
        </label>
        <input id="business_email" name="business_email" type="email" defaultValue={businessEmail} className="input" />
      </div>
      {state.error ? <p className="text-sm text-brand-red">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-600">Saved.</p> : null}
      <SubmitButton />
    </form>
  );
}
