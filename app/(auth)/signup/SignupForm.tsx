"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { signUpAction, type AuthActionState } from "../actions";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { cn } from "@/lib/utils";

const initialState: AuthActionState = { error: null };

function SubmitButton({ accountType }: { accountType: "customer" | "vendor" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Creating account…" : accountType === "vendor" ? "Submit vendor application" : "Create account"}
    </button>
  );
}

export function SignupForm() {
  const [state, formAction] = useFormState(signUpAction, initialState);
  const [accountType, setAccountType] = useState<"customer" | "vendor">("customer");

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="account_type" value={accountType} />

      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => setAccountType("customer")}
          className={cn("rounded-md px-3 py-2 transition", accountType === "customer" ? "bg-white shadow-sm text-brand-navy" : "text-slate-500")}
        >
          I&rsquo;m shopping
        </button>
        <button
          type="button"
          onClick={() => setAccountType("vendor")}
          className={cn("rounded-md px-3 py-2 transition", accountType === "vendor" ? "bg-white shadow-sm text-brand-navy" : "text-slate-500")}
        >
          I&rsquo;m a vendor
        </button>
      </div>

      <div>
        <label className="label" htmlFor="full_name">
          Full name
        </label>
        <input id="full_name" name="full_name" type="text" required autoComplete="name" className="input" placeholder="Jane Doe" />
      </div>

      <div>
        <label className="label" htmlFor="email">
          Email address
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" placeholder="you@example.com" />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="input"
          placeholder="At least 8 characters"
        />
      </div>

      {accountType === "vendor" ? (
        <div className="space-y-5 rounded-lg border border-dashed border-slate-300 p-4">
          <p className="text-sm text-slate-600">
            Vendor accounts require review. You&rsquo;ll get dashboard access once an admin approves your application.
          </p>

          <div>
            <label className="label" htmlFor="business_name">
              Business name
            </label>
            <input id="business_name" name="business_name" type="text" required={accountType === "vendor"} className="input" placeholder="Girlee Fashion" />
          </div>

          <div>
            <label className="label" htmlFor="id_document_type">
              ID document type
            </label>
            <select id="id_document_type" name="id_document_type" required={accountType === "vendor"} className="input" defaultValue="">
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
              required={accountType === "vendor"}
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
              required={accountType === "vendor"}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-navy file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
            />
          </div>
        </div>
      ) : null}

      {state.error ? <p className="text-sm text-brand-red">{state.error}</p> : null}

      <SubmitButton accountType={accountType} />

      <GoogleSignInButton />

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-brand-blue underline underline-offset-2">
          Log in
        </Link>
      </p>
    </form>
  );
}
