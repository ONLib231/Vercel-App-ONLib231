"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Home, Settings, Truck, Wallet, type LucideIcon } from "lucide-react";

interface TabItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Mobile-only fixed bottom navigation for the Delivery admin dashboard. */
export function DeliveryAdminBottomTabBar() {
  const pathname = usePathname();

  const tabs: TabItem[] = [
    { href: "/delivery/admin", label: "Home", icon: Home },
    { href: "/delivery/admin/orders", label: "Orders", icon: ClipboardList },
    { href: "/delivery/admin/fleet", label: "Fleet", icon: Truck },
    { href: "/delivery/admin/expenses", label: "Expenses", icon: Wallet },
    { href: "/delivery/admin/settings", label: "Settings", icon: Settings },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-slate-100 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Delivery admin primary"
    >
      {tabs.map((tab) => {
        const isActive = tab.href === "/delivery/admin" ? pathname === tab.href : pathname?.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`tap-target relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition ${
              isActive ? "text-verta-700" : "text-slate-400"
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
