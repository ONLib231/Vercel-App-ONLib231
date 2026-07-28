"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ClipboardList, Home, MessageSquare, UserRound, type LucideIcon } from "lucide-react";

interface TabItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeCount?: number;
}

export interface VendorBottomTabBarProps {
  messagesCount?: number;
}

/** Mobile-only fixed bottom navigation for the Vendor Dashboard (see the attached mobile mockup). */
export function VendorBottomTabBar({ messagesCount = 0 }: VendorBottomTabBarProps) {
  const pathname = usePathname();

  const tabs: TabItem[] = [
    { href: "/vendor", label: "Home", icon: Home },
    { href: "/vendor/products", label: "Products", icon: Boxes },
    { href: "/vendor/orders", label: "Orders", icon: ClipboardList },
    { href: "/vendor/messages", label: "Messages", icon: MessageSquare, badgeCount: messagesCount },
    { href: "/vendor/account", label: "Account", icon: UserRound },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-slate-100 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Vendor primary"
    >
      {tabs.map((tab) => {
        const isActive = tab.href === "/vendor" ? pathname === tab.href : pathname?.startsWith(tab.href);
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
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden />
              {!!tab.badgeCount && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-onlib-600 px-1 text-[10px] font-semibold text-white">
                  {tab.badgeCount > 9 ? "9+" : tab.badgeCount}
                </span>
              )}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
