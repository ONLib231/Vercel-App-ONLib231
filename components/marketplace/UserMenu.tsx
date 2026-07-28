"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, LogIn } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import type { NavUser } from "@/types/marketplace";

export interface UserMenuProps {
  /** null = signed out — renders a plain "Login" link instead of the account
   *  dropdown, so guests never see My Account / Orders / Log Out. */
  user: NavUser | null;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * Desktop-only account dropdown in the top-right of the marketplace header
 * ("Girlee Fashion / Customer" in the mockup). `user` is passed in from the
 * server (lib/user.ts#getNavUser) rather than fetched here, so this stays a
 * small client component purely for the open/close interaction.
 */
export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <Link
        href="/login?next=/marketplace"
        className="tap-target flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-verta-700 transition hover:bg-verta-50"
      >
        <LogIn className="h-[18px] w-[18px]" aria-hidden />
        Login
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="tap-target flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-slate-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-verta-100 text-xs font-bold text-verta-700">
          {initialsFor(user.name)}
        </span>
        <span className="hidden text-left leading-tight md:block">
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
          <a href="/marketplace/account" role="menuitem" className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            My Account
          </a>
          <a href="/marketplace/orders" role="menuitem" className="block px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Orders
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
  );
}
