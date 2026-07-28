import Image from "next/image";
import Link from "next/link";
import { HelpCircle, LayoutGrid, Lock } from "lucide-react";
import { ServiceCard } from "./ServiceCard";
import type { ServiceOptionViewModel } from "@/types/service";

export interface ServiceSelectorProps {
  /** Rendered as ServiceCard entries, in display order. */
  options: ServiceOptionViewModel[];
  /** Where the Help link goes; defaults to a generic help center route. */
  helpHref?: string;
  /**
   * Site-wide header logo. Defaults to the local ONLib wordmark shipped in
   * public/images/logos, but accepts any dynamic URL (e.g. a Supabase
   * Storage public URL) so brand assets can be swapped without a redeploy.
   */
  logoSrc?: string;
  logoAlt?: string;
  logoHref?: string;
}

/**
 * "What would you like to do?" — the shared entry screen that lets a
 * customer choose between the Verta Delivery flow and the ONLib
 * Marketplace flow from a single account.
 *
 * Pure presentational component: data comes in via `options` (see
 * lib/services.ts#getServiceOptions), so this can be rendered from a
 * Server Component with live Supabase data or from a story/test with
 * static fixtures.
 */
export function ServiceSelector({
  options,
  helpHref = "/help",
  logoSrc = "/images/logos/onlib-logo-full.jpeg",
  logoAlt = "ONLib — Shop & Delivery",
  logoHref = "/",
}: ServiceSelectorProps) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4 sm:px-8">
        <Link href={logoHref} className="flex items-center" aria-label={logoAlt}>
          <Image
            src={logoSrc}
            alt={logoAlt}
            width={192}
            height={120}
            priority
            className="h-9 w-auto object-contain sm:h-11"
          />
        </Link>

        <Link
          href={helpHref}
          className="tap-target flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <HelpCircle className="h-5 w-5" aria-hidden />
          <span className="hidden sm:inline">Help Center</span>
          <span className="sm:hidden">Help</span>
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-4 py-10 sm:py-16">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm">
          <LayoutGrid className="h-7 w-7 text-verta-600" aria-hidden />
        </span>

        <h1 className="mt-6 text-center text-3xl font-extrabold text-verta-900 sm:text-4xl">
          What would you like to do?
        </h1>
        <p className="mt-2 text-center text-base text-slate-500 sm:text-lg">
          Two separate services, one account.
        </p>

        <div className="mt-8 grid w-full gap-5 md:grid-cols-2 md:gap-6">
          {options.map((option, index) => (
            <div key={option.key} className="contents">
              <ServiceCard option={option} />
              {index === 0 && options.length > 1 && (
                <div className="flex items-center gap-3 md:hidden" role="presentation">
                  <span className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Or
                  </span>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-500">
          <Lock className="h-4 w-4" aria-hidden />
          <span>One account. Two powerful experiences.</span>
        </div>
      </main>

      <footer className="border-t border-slate-100 px-4 py-6 text-center text-xs text-slate-400 sm:flex sm:items-center sm:justify-between sm:px-8">
        <p>&copy; {year} ONLib. All rights reserved.</p>
        <nav className="mt-3 flex items-center justify-center gap-3 sm:mt-0">
          <Link href="/privacy" className="hover:text-slate-600">
            Privacy Policy
          </Link>
          <span aria-hidden>|</span>
          <Link href="/terms" className="hover:text-slate-600">
            Terms of Service
          </Link>
        </nav>
      </footer>
    </div>
  );
}
