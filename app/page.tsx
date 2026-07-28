import Image from "next/image";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";

export default async function HubPage() {
  const profile = await getCurrentProfile();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <Image src="/verta-logo.png" alt="Verta" width={140} height={48} className="h-10 w-auto object-contain" priority />
        <nav className="flex items-center gap-4 text-sm">
          {profile ? (
            <>
              {profile.role === "admin" ? (
                <Link href="/admin" className="font-medium text-slate-600 hover:text-brand-navy">
                  Admin
                </Link>
              ) : null}
              {profile.role === "vendor" ? (
                <Link href="/vendor/dashboard" className="font-medium text-slate-600 hover:text-brand-navy">
                  Vendor dashboard
                </Link>
              ) : null}
              <span className="text-slate-500">Hi, {profile.full_name ?? "there"}</span>
            </>
          ) : (
            <>
              <Link href="/login" className="font-medium text-slate-600 hover:text-brand-navy">
                Log in
              </Link>
              <Link href="/signup" className="rounded-lg bg-brand-navy px-4 py-2 font-semibold text-white hover:bg-slate-800">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-blue" fill="currentColor">
            <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v4h-4v3h-3v-7z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">What would you like to do?</h1>
        <p className="mt-2 text-slate-500">Two separate services, one account.</p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          <Link href="/delivery" className="card group flex items-center gap-5 p-6 text-left transition hover:shadow-md">
            <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
              <Image src="/verta-logo.png" alt="Verta Delivery" width={80} height={40} className="h-8 w-auto object-contain" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-brand-blue">Verta Delivery</h2>
              <p className="text-sm text-slate-500">Send a package, on demand</p>
              <span className="mt-2 inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-brand-blue">
                ⚡ Fast. Reliable. Secure.
              </span>
            </div>
            <span className="text-slate-300 transition group-hover:text-brand-blue">→</span>
          </Link>

          <Link href="/marketplace" className="card group flex items-center gap-5 p-6 text-left transition hover:shadow-md">
            <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-red-50">
              <Image
                src="/onlib-logo.jpg"
                alt="ONLib Marketplace"
                width={80}
                height={40}
                className="h-8 w-auto object-contain"
              />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-brand-red">ONLib Marketplace</h2>
              <p className="text-sm text-slate-500">Shop products from real vendors</p>
              <span className="mt-2 inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-brand-red">
                🏷 Quality. Trusted. Convenient.
              </span>
            </div>
            <span className="text-slate-300 transition group-hover:text-brand-red">→</span>
          </Link>
        </div>

        <p className="mt-10 flex items-center justify-center gap-2 text-sm text-slate-400">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M12 1a5 5 0 00-5 5v3H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-1V6a5 5 0 00-5-5zm-3 8V6a3 3 0 116 0v3z" />
          </svg>
          One account. Two powerful experiences.
        </p>
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        <Link href="/privacy" className="hover:underline">
          Privacy Policy
        </Link>{" "}
        &nbsp;|&nbsp;
        <Link href="/terms" className="hover:underline">
          Terms of Service
        </Link>
      </footer>
    </div>
  );
}
