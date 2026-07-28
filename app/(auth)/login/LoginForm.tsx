"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { signInAction, type AuthActionState } from "../actions";
import { GoogleSignInButton } from "@/components/google-signin-button";

const initialState: AuthActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Signing in…" : "Log in"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useFormState(signInAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

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
          autoComplete="current-password"
          className="input"
          placeholder="••••••••"
        />
      </div>

      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" name="remember" className="h-4 w-4 rounded border-slate-300" />
          Remember for 30 days
        </label>
        <Link href="/forgot-password" className="font-medium text-brand-blue underline underline-offset-2">
          Forgot password
        </Link>
      </div>

      {state.error ? <p className="text-sm text-brand-red">{state.error}</p> : null}

      <SubmitButton />

      <GoogleSignInButton />

      <p className="text-center text-sm text-slate-500">
        Don&rsquo;t have an account?{" "}
        <Link href="/signup" className="font-semibold text-brand-blue underline underline-offset-2">
          Sign up
        </Link>
      </p>
    </form>
  );
}
