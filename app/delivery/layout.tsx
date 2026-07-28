import Image from "next/image";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { signOutAction } from "@/app/(auth)/actions";

export default async function DeliveryLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/">
            <Image src="/verta-logo.png" alt="Verta Delivery" width={130} height={44} className="h-9 w-auto object-contain" priority />
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {profile ? (
              <>
                {profile.role === "admin" ? (
                  <Link href="/admin/delivery" className="font-medium text-slate-600 hover:text-brand-navy">
                    Delivery Admin
                  </Link>
                ) : null}
                <form action={signOutAction}>
                  <button type="submit" className="font-medium text-slate-400 hover:text-brand-red">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href="/login?next=/delivery" className="font-medium text-brand-blue hover:underline">
                Log in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
