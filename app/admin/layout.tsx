import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { signOutAction } from "@/app/(auth)/actions";

const NAV_GROUPS: { heading: string; items: { href: string; label: string }[] }[] = [
  {
    heading: "Super Admin",
    items: [
      { href: "/admin", label: "Overview" },
      { href: "/admin/vendor-applications", label: "Vendor Applications" },
      { href: "/admin/users", label: "Users" },
      { href: "/admin/categories", label: "Categories" },
      { href: "/admin/orders", label: "Marketplace Orders" },
    ],
  },
  {
    heading: "Delivery Admin",
    items: [
      { href: "/admin/delivery", label: "Orders" },
      { href: "/admin/delivery/agents", label: "Fleet / Agents" },
      { href: "/admin/delivery/expenses", label: "Expenses" },
      { href: "/admin/delivery/presets", label: "Price Presets" },
      { href: "/admin/delivery/settings", label: "Business Settings" },
    ],
  },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 flex-shrink-0 border-r border-slate-200 bg-white sm:block">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <Image src="/onlib-logo.jpg" alt="ONLib" width={100} height={32} className="h-7 w-auto object-contain" />
          <span className="text-xs font-semibold text-slate-400">ADMIN</span>
        </div>
        <nav className="space-y-5 p-3 text-sm">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading}>
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{group.heading}</p>
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} className="block rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100">
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <p className="px-3 text-xs text-slate-400">{profile.full_name}</p>
          <form action={signOutAction} className="px-3 pt-1">
            <button type="submit" className="text-xs font-medium text-slate-400 hover:text-brand-red">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-4 sm:p-8">{children}</main>
    </div>
  );
}
