"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  CreditCard,
  Heart,
  HelpCircle,
  Home,
  LayoutGrid,
  LogIn,
  LogOut,
  MapPin,
  MessageSquare,
  Settings,
  Store,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { MarketplaceLogo } from "./MarketplaceLogo";
import { signOut } from "@/lib/actions/auth";
import type { NavUser } from "@/types/marketplace";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeCount?: number;
  /** Account-scoped page — only shown to signed-in users (see middleware.ts PROTECTED_PREFIXES). */
  requiresAuth?: boolean;
}

export interface SidebarProps {
  wishlistCount?: number;
  /** null = signed out → shows "Login"; a NavUser → shows "Logout". */
  user: NavUser | null;
}

/**
 * Desktop-only left navigation rail (see the desktop marketplace mockup).
 * Hidden below the `lg` breakpoint — MarketplaceHeader + BottomTabBar cover
 * the same navigation on mobile instead of squeezing this into a drawer.
 */
export function Sidebar({ wishlistCount = 0, user }: SidebarProps) {
  const pathname = usePathname();

  const allItems: NavItem[] = [
    { href: "/marketplace", label: "Home", icon: Home },
    { href: "/marketplace/categories", label: "Categories", icon: LayoutGrid },
    { href: "/marketplace/stores", label: "Stores", icon: Store },
    { href: "/marketplace/deals", label: "Deals", icon: Tag },
    { href: "/marketplace/orders", label: "Orders", icon: ClipboardList, requiresAuth: true },
    { href: "/marketplace/wishlist", label: "Wishlist", icon: Heart, badgeCount: wishlistCount, requiresAuth: true },
    { href: "/marketplace/messages", label: "Messages", icon: MessageSquare, requiresAuth: true },
    { href: "/marketplace/addresses", label: "Addresses", icon: MapPin, requiresAuth: true },
    { href: "/marketplace/payment-methods", label: "Payment Methods", icon: CreditCard, requiresAuth: true },
    { href: "/marketplace/settings", label: "Settings", icon: Settings, requiresAuth: true },
    { href: "/help", label: "Help Center", icon: HelpCircle },
  ];

  // Signed-out visitors only see public browsing links (Home, Categories,
  // Stores, Deals, Help Center) — account-scoped pages are hidden entirely
  // rather than shown and gated on click.
  const items = user ? allItems : allItems.filter((item) => !item.requiresAuth);

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-100 bg-white px-4 py-5 lg:flex">
      <div className="px-2 pb-6">
        <MarketplaceLogo className="h-9 w-auto" />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const isActive = item.href === "/marketplace" ? pathname === item.href : pathname?.startsWith(item.href);
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

      {user ? (
        <form action={signOut}>
          <button
            type="submit"
            className="mt-4 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-onlib-600 transition hover:bg-onlib-50"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden />
            Logout
          </button>
        </form>
      ) : (
        <Link
          href="/login?next=/marketplace"
          className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-verta-700 transition hover:bg-verta-50"
        >
          <LogIn className="h-[18px] w-[18px]" aria-hidden />
          Login
        </Link>
      )}
    </aside>
  );
}
