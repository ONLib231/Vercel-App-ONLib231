"use client";

import { useFormState, useFormStatus } from "react-dom";
import { submitVendorApplicationAction, type VendorApplyState } from "./actions";

const initialState: VendorApplyState = { error: null };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Submitting…" : label}
    </button>
  );
}

export function ApplyForm({ defaultBusinessName, submitLabel }: { defaultBusinessName?: string; submitLabel: string }) {
  const [state, formAction] = useFormState(submitVendorApplicationAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label className="label" htmlFor="business_name">
          Business name
        </label>
        <input id="business_name" name="business_name" type="text" required defaultValue={defaultBusinessName} className="input" />
      </div>

      <div>
        <label className="label" htmlFor="id_document_type">
          ID document type
        </label>
        <select id="id_document_type" name="id_document_type" required className="input" defaultValue="">
          <option value="" disabled>
            Select a document type
          </option>
          <option value="passport">Passport</option>
          <option value="national_id">National ID</option>
          <option value="drivers_license">Driver&rsquo;s license</option>
        </select>
      </div>

      <div>
        <label className="label" htmlFor="business_registration">
          Business registration document
        </label>
        <input
          id="business_registration"
          name="business_registration"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-navy file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
        />
      </div>

      <div>
        <label className="label" htmlFor="id_document">
          ID document
        </label>
        <input
          id="id_document"
          name="id_document"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-navy file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
        />
      </div>

      {state.error ? <p className="text-sm text-brand-red">{state.error}</p> : null}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
