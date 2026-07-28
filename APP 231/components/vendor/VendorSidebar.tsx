"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Tag,
  UserRound,
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

export interface VendorSidebarProps {
  messagesCount?: number;
}

/**
 * Desktop-only left nav for the Vendor Dashboard (see the attached desktop
 * mockup) — same "hidden below lg" pattern as the marketplace Sidebar, with
 * VendorHeader + VendorBottomTabBar covering navigation on mobile instead.
 */
export function VendorSidebar({ messagesCount = 0 }: VendorSidebarProps) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/vendor", label: "Dashboard", icon: LayoutDashboard },
    { href: "/vendor/products", label: "Products", icon: Boxes },
    { href: "/vendor/orders", label: "Orders", icon: ClipboardList },
    { href: "/vendor/messages", label: "Messages", icon: MessageSquare, badgeCount: messagesCount },
    { href: "/vendor/leads", label: "Leads", icon: UserRound },
    { href: "/vendor/reports", label: "Reports", icon: BarChart3 },
    { href: "/vendor/customers", label: "Customers", icon: Users },
    { href: "/vendor/promotions", label: "Promotions", icon: Tag },
    { href: "/vendor/settings", label: "Settings", icon: Settings },
    { href: "/help", label: "Help Center", icon: HelpCircle },
  ];

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-slate-100 bg-white px-4 py-5 lg:flex">
      <div className="px-2 pb-6">
        <MarketplaceLogo className="h-9 w-auto" />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const isActive = item.href === "/vendor" ? pathname === item.href : pathname?.startsWith(item.href);
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
