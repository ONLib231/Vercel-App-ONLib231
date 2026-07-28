"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Briefcase, CheckCircle2, Clock3, User as UserIcon } from "lucide-react";
import { signUpAccount } from "@/lib/actions/auth";
import { GoogleButton } from "./GoogleButton";

export interface SignupFormProps {
  next?: string;
}

type AccountType = "customer" | "vendor";

const inputClass =
  "w-full rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-verta-500 focus:outline-none focus:ring-1 focus:ring-verta-500";

export function SignupForm({ next }: SignupFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [submittedAccountType, setSubmittedAccountType] = useState<AccountType>("customer");

  const [accountType, setAccountType] = useState<AccountType>("customer");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Vendor-only fields
  const [businessName, setBusinessName] = useState("");
  const [idDocumentType, setIdDocumentType] = useState("");
  const [businessRegistrationFile, setBusinessRegistrationFile] = useState<File | null>(null);
  const [idDocumentFile, setIdDocumentFile] = useState<File | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      return setError("Password must be at least 8 characters.");
    }
    if (password !== confirmPassword) {
      return setError("Passwords don't match. Please re-enter them.");
    }

    if (accountType === "vendor") {
      if (!businessName.trim()) return setError("Enter your business name.");
      if (!idDocumentType) return setError("Select an identification document type.");
      if (!businessRegistrationFile) return setError("Upload your business registration document.");
      if (!idDocumentFile) return setError("Upload your identification document.");
    }

    const formData = new FormData();
    formData.set("fullName", fullName);
    formData.set("email", email);
    formData.set("phone", phone);
    formData.set("password", password);
    formData.set("accountType", accountType);
    if (next) formData.set("next", next);

    if (accountType === "vendor") {
      formData.set("businessName", businessName);
      formData.set("idDocumentType", idDocumentType);
      if (businessRegistrationFile) formData.set("businessRegistrationFile", businessRegistrationFile);
      if (idDocumentFile) formData.set("idDocumentFile", idDocumentFile);
    }

    startTransition(async () => {
      const result = await signUpAccount(formData);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
      } else if (result.needsEmailConfirmation || result.accountType === "vendor") {
        setSubmittedAccountType(result.accountType ?? accountType);
        setNeedsConfirmation(true);
      }
      // Otherwise the action already redirected server-side.
    });
  }

  if (needsConfirmation) {
    if (submittedAccountType === "vendor") {
      return (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <Clock3 className="h-10 w-10 text-verta-600" aria-hidden />
          <p className="text-sm font-semibold text-slate-800">Vendor application submitted</p>
          <p className="text-sm text-slate-600">
            We received your business registration and identification documents for{" "}
            <span className="font-semibold">{businessName}</span>. Our team reviews new vendor applications directly
            in Supabase — once yours is approved, just log back in with{" "}
            <span className="font-semibold">{email}</span> to reach your Vendor Dashboard.
          </p>
          <Link href="/" className="mt-2 text-sm font-semibold text-verta-600 hover:text-verta-700">
            Back to Dashboard
          </Link>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="h-10 w-10 text-verta-600" aria-hidden />
        <p className="text-sm text-slate-600">
          We sent a confirmation link to <span className="font-semibold">{email}</span>. Click it to activate your
          account, then log in.
        </p>
        <Link href="/" className="mt-2 text-sm font-semibold text-verta-600 hover:text-verta-700">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">I want to</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setAccountType("customer")}
            aria-pressed={accountType === "customer"}
            className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
              accountType === "customer"
                ? "border-verta-500 bg-verta-50 text-verta-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            <UserIcon className="h-[18px] w-[18px]" aria-hidden />
            Shop (Customer)
          </button>
          <button
            type="button"
            onClick={() => setAccountType("vendor")}
            aria-pressed={accountType === "vendor"}
            className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
              accountType === "vendor"
                ? "border-verta-500 bg-verta-50 text-verta-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            <Briefcase className="h-[18px] w-[18px]" aria-hidden />
            Sell (Vendor)
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="fullName" className="sr-only">
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
            className={inputClass}
          />
        </div>

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
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="phone" className="sr-only">
            Contact number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Contact number"
            className={inputClass}
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min. 8 characters)"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="sr-only">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            className={inputClass}
          />
        </div>

        {accountType === "vendor" && (
          <div className="space-y-4 rounded-xl border border-verta-100 bg-verta-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-verta-700">Vendor details</p>

            <div>
              <label htmlFor="businessName" className="sr-only">
                Business name
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Business name"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="idDocumentType" className="mb-1 block text-xs font-medium text-slate-500">
                Identification type
              </label>
              <select
                id="idDocumentType"
                required
                value={idDocumentType}
                onChange={(e) => setIdDocumentType(e.target.value)}
                className={`${inputClass} bg-white`}
              >
                <option value="" disabled>
                  Select ID type
                </option>
                <option value="passport">Passport</option>
                <option value="national_id">National ID</option>
                <option value="drivers_license">Driver's License</option>
              </select>
            </div>

            <div>
              <label htmlFor="businessRegistrationFile" className="mb-1 block text-xs font-medium text-slate-500">
                Business registration document
              </label>
              <input
                id="businessRegistrationFile"
                type="file"
                required
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setBusinessRegistrationFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-verta-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-verta-700"
              />
            </div>

            <div>
              <label htmlFor="idDocumentFile" className="mb-1 block text-xs font-medium text-slate-500">
                Identification document (Passport, National ID, or Driver's License)
              </label>
              <input
                id="idDocumentFile"
                type="file"
                required
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setIdDocumentFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-verta-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-verta-700"
              />
            </div>

            <p className="text-xs text-slate-500">
              These documents are sent for review to our Super Admin team so your store can be approved. You'll be
              notified once your vendor account is active.
            </p>
          </div>
        )}

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
          {isPending
            ? accountType === "vendor"
              ? "Submitting application..."
              : "Creating account..."
            : accountType === "vendor"
              ? "Submit Vendor Application"
              : "Create Account"}
        </button>
      </form>

      {accountType === "customer" && <GoogleButton next={next} label="Sign up with Google" />}

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="font-semibold text-verta-600 hover:text-verta-700"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
