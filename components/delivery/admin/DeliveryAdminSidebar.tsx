"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Settings,
  Tag,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { MarketplaceLogo } from "@/components/marketplace/MarketplaceLogo";
import { signOut } from "@/lib/actions/auth";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Desktop-only left nav for the Delivery admin dispatch dashboard — mirrors VendorSidebar's structure/behavior. */
export function DeliveryAdminSidebar() {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/delivery/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/delivery/admin/orders", label: "Orders", icon: ClipboardList },
    { href: "/delivery/admin/fleet", label: "Fleet", icon: Truck },
    { href: "/delivery/admin/expenses", label: "Expenses", icon: Wallet },
    { href: "/delivery/admin/pricing", label: "Pricing", icon: Tag },
    { href: "/delivery/admin/customers", label: "Customers", icon: Users },
    { href: "/delivery/admin/reports", label: "Reports", icon: BarChart3 },
    { href: "/delivery/admin/settings", label: "Settings", icon: Settings },
    { href: "/help", label: "Help Center", icon: HelpCircle },
  ];

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-100 bg-white px-4 py-5 lg:flex">
      <div className="px-2 pb-6">
        <MarketplaceLogo className="h-9 w-auto" />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const isActive =
            item.href === "/delivery/admin" ? pathname === item.href : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive ? "bg-verta-50 text-verta-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <form action={signOut}>
        <button
          type="submit"
          className="mt-4 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-onlib-600 transition hover:bg-onlib-50"
        >
          <LogOut className="h-[18px] w-[18px]" aria-hidden />
          Logout
        </button>
      </form>
    </aside>
  );
}
