"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signInWithPassword } from "@/lib/actions/auth";
import { GoogleButton } from "./GoogleButton";

export interface LoginFormProps {
  next?: string;
}

export function LoginForm({ next }: LoginFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signInWithPassword({ email, password, next });
      // A successful sign-in redirects server-side and never resolves back
      // here; only failures return a value to display.
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="email" className="sr-only">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-verta-500 focus:outline-none focus:ring-1 focus:ring-verta-500"
          />
        </div>

        <div>
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-verta-500 focus:outline-none focus:ring-1 focus:ring-verta-500"
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-slate-600">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-verta-600 focus:ring-verta-500"
            />
            Remember for 30 days
          </label>
          <Link href="/forgot-password" className="font-medium text-verta-600 hover:text-verta-700">
            Forgot password
          </Link>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-onlib-50 px-3 py-2 text-sm text-onlib-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="tap-target w-full rounded-lg bg-verta-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-verta-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Logging in..." : "Log In"}
        </button>
      </form>

      <GoogleButton next={next} label="Sign in with Google" />

      <p className="text-center text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link
          href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          className="font-semibold text-verta-600 hover:text-verta-700"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
