"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Package,
  ShoppingBag,
  Tags,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { MarketplaceLogo } from "@/components/marketplace/MarketplaceLogo";
import { signOut } from "@/lib/actions/auth";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeCount?: number;
}

export interface AdminSidebarProps {
  pendingVendorApplications?: number;
}

/** Desktop-only left nav for the Super Admin dashboard — same structural pattern as VendorSidebar/DeliveryAdminSidebar. */
export function AdminSidebar({ pendingVendorApplications = 0 }: AdminSidebarProps) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/vendor-applications", label: "Vendor Applications", icon: ClipboardCheck, badgeCount: pendingVendorApplications },
    { href: "/admin/users", label: "Users & Roles", icon: Users },
    { href: "/admin/categories", label: "Categories", icon: Tags },
    { href: "/admin/service-cards", label: "Service Cards", icon: Package },
    { href: "/admin/orders", label: "Orders Overview", icon: ShoppingBag },
    { href: "/help", label: "Help Center", icon: HelpCircle },
  ];

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-100 bg-white px-4 py-5 lg:flex">
      <div className="px-2 pb-6">
        <MarketplaceLogo className="h-9 w-auto" />
        <p className="mt-1 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Super Admin</p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const isActive = item.href === "/admin" ? pathname === item.href : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive ? "bg-verta-50 text-verta-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
                {item.label}
              </span>
              {!!item.badgeCount && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-onlib-600 px-1.5 text-[11px] font-semibold text-white">
                  {item.badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <Link
        href="/delivery/admin"
        className="mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50"
      >
        <Truck className="h-[18px] w-[18px]" aria-hidden />
        Delivery Admin
      </Link>

      <form action={signOut}>
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-onlib-600 transition hover:bg-onlib-50"
        >
          <LogOut className="h-[18px] w-[18px]" aria-hidden />
          Logout
        </button>
      </form>
    </aside>
  );
}
