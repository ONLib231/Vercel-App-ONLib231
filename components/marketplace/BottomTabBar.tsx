"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, Home, LayoutGrid, LogIn, Store, User, type LucideIcon } from "lucide-react";
import type { NavUser } from "@/types/marketplace";

interface TabItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeCount?: number;
}

export interface BottomTabBarProps {
  wishlistCount?: number;
  /** null = signed out → last tab reads "Login" instead of "Account". */
  user: NavUser | null;
}

/**
 * Mobile-only fixed bottom navigation (Home / Categories / Stores /
 * Wishlist / Account) — the desktop Sidebar covers the full nav instead.
 */
export function BottomTabBar({ wishlistCount = 0, user }: BottomTabBarProps) {
  const pathname = usePathname();

  // Wishlist is account-scoped (see middleware.ts PROTECTED_PREFIXES) — hide
  // it entirely for signed-out visitors instead of showing it and gating the
  // tap. Same public-vs-account split as the desktop Sidebar.
  const tabs: TabItem[] = [
    { href: "/marketplace", label: "Home", icon: Home },
    { href: "/marketplace/categories", label: "Categories", icon: LayoutGrid },
    { href: "/marketplace/stores", label: "Stores", icon: Store },
    ...(user ? [{ href: "/marketplace/wishlist", label: "Wishlist", icon: Heart, badgeCount: wishlistCount }] : []),
    user
      ? { href: "/marketplace/account", label: "Account", icon: User }
      : { href: "/login?next=/marketplace", label: "Login", icon: LogIn },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-slate-100 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Primary"
    >
      {tabs.map((tab) => {
        const isActive = tab.href === "/marketplace" ? pathname === tab.href : pathname?.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`tap-target relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition ${
              isActive ? "text-onlib-600" : "text-slate-400"
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
