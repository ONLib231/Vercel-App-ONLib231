import Image from "next/image";
import Link from "next/link";
import { requireApprovedVendor } from "@/lib/auth";
import { signOutAction } from "@/app/(auth)/actions";

export default async function VendorDashboardLayout({ children }: { children: React.ReactNode }) {
  const { profile, store } = await requireApprovedVendor();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-60 flex-shrink-0 border-r border-slate-200 bg-white sm:block">
        <div className="border-b border-slate-100 p-4">
          <Image src="/onlib-logo.jpg" alt="ONLib" width={110} height={36} className="h-8 w-auto object-contain" />
          <p className="mt-3 text-sm font-semibold text-slate-800">{store.name}</p>
          <p className="text-xs text-slate-400">Vendor · {profile.full_name}</p>
        </div>
        <nav className="space-y-1 p-3 text-sm">
          <Link href="/vendor/dashboard" className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100">
            Dashboard
          </Link>
          <Link href="/vendor/dashboard/products" className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100">
            Products
          </Link>
          <Link href="/vendor/dashboard/orders" className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100">
            Orders
          </Link>
          <Link href="/marketplace" className="block rounded-lg px-3 py-2 font-medium text-slate-500 hover:bg-slate-100">
            View storefront
          </Link>
        </nav>
        <form action={signOutAction} className="p-3">
          <button type="submit" className="text-xs font-medium text-slate-400 hover:text-brand-red">
            Sign out
          </button>
        </form>
      </aside>
      <main className="flex-1 p-4 sm:p-8">{children}</main>
    </div>
  );
}
