"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createDeliveryOrderAction, type DeliveryOrderState } from "./actions";

const initialState: DeliveryOrderState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Placing order…" : "Request pickup"}
    </button>
  );
}

export function DeliveryOrderForm({ defaultName }: { defaultName?: string }) {
  const [state, formAction] = useFormState(createDeliveryOrderAction, initialState);

  return (
    <form action={formAction} className="card space-y-5 p-6">
      <div>
        <label className="label" htmlFor="sender_name">
          Your name
        </label>
        <input id="sender_name" name="sender_name" required defaultValue={defaultName} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="sender_phone">
          Phone number
        </label>
        <input id="sender_phone" name="sender_phone" type="tel" className="input" placeholder="Optional, in case we need to reach you" />
      </div>
      <div>
        <label className="label" htmlFor="pickup_address">
          Pickup address
        </label>
        <input id="pickup_address" name="pickup_address" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="dropoff_address">
          Dropoff address
        </label>
        <input id="dropoff_address" name="dropoff_address" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="item_description">
          What are we delivering?
        </label>
        <textarea id="item_description" name="item_description" required rows={3} className="input" placeholder="e.g. Sealed envelope, 2kg parcel…" />
      </div>

      {state.error ? <p className="text-sm text-brand-red">{state.error}</p> : null}

      <SubmitButton />
    </form>
  );
}
