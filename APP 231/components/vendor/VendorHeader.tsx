"use client";

import { useState } from "react";
import { Bell, ChevronDown, Menu } from "lucide-react";
import { MarketplaceLogo } from "@/components/marketplace/MarketplaceLogo";
import { signOut } from "@/lib/actions/auth";
import type { VendorNavUser } from "@/types/vendor";

export interface VendorHeaderProps {
  user: VendorNavUser;
  notificationsCount?: number;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Top chrome for the Vendor Dashboard. Mirrors MarketplaceHeader's
 * mobile-vs-desktop split (see the two attached mockups):
 *  - Mobile (< lg): logo + bell — the VendorSidebar is hidden below lg, so
 *    there's no room for the account chip here (VendorBottomTabBar's
 *    "Account" tab covers it instead).
 *  - Desktop (>= lg): a decorative menu icon (collapses the sidebar in a
 *    future pass), bell, and the "Girlee Fashion / Admin" account dropdown.
 */
export function VendorHeader({ user, notificationsCount = 0 }: VendorHeaderProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white">
      {/* Mobile */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:hidden">
        <MarketplaceLogo href="/vendor" className="h-8 w-auto" />
        <span className="relative rounded-lg p-2 text-slate-500">
          <Bell className="h-5 w-5" aria-hidden />
          {notificationsCount > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-onlib-600 px-1 text-[10px] font-semibold text-white">
              {notificationsCount > 9 ? "9+" : notificationsCount}
            </span>
          )}
        </span>
      </div>

      {/* Desktop */}
      <div className="hidden items-center justify-between gap-4 px-6 py-3 lg:flex">
        <button
          type="button"
          aria-label="Toggle sidebar"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
        >
          <Menu className="h-[18px] w-[18px]" aria-hidden />
        </button>

        <div className="flex items-center gap-1">
          <span className="relative rounded-lg p-2 text-slate-500">
            <Bell className="h-5 w-5" aria-hidden />
            {notificationsCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-onlib-600 px-1 text-[10px] font-semibold text-white">
                {notificationsCount > 9 ? "9+" : notificationsCount}
              </span>
            )}
          </span>

          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={open}
              className="tap-target flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-slate-100"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-verta-100 text-xs font-bold text-verta-700">
                {initialsFor(user.name)}
              </span>
              <span className="text-left leading-tight">
                <span className="block text-sm font-semibold text-slate-800">{user.name}</span>
                <span className="block text-xs text-slate-400">{user.role}</span>
              </span>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
            </button>

            {open && (
              <div
                role="menu"
                className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-xl border border-slate-100 bg-white py-1 shadow-lg"
              >
                <a href="/vendor/settings" role="menuitem" className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  Store Settings
                </a>
                <form action={signOut}>
                  <button
                    type="submit"
                    role="menuitem"
                    className="block w-full px-4 py-2 text-left text-sm text-onlib-600 hover:bg-slate-50"
                  >
                    Log Out
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
