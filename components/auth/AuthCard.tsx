import Link from "next/link";
import { MarketplaceLogo } from "@/components/marketplace/MarketplaceLogo";

export interface AuthCardProps {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}

/**
 * Shared centered-card shell for /login and /signup (see the reference
 * "Welcome back" mockup) — logo up top, then eyebrow + heading, then
 * whichever form the page passes in as children.
 */
export function AuthCard({ eyebrow, title, children }: AuthCardProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <Link href="/marketplace" className="mb-6">
        <MarketplaceLogo className="h-10 w-auto" />
      </Link>

      <div className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm text-slate-400">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-extrabold text-verta-900 sm:text-3xl">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
