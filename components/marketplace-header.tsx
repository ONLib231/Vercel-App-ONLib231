import Image from "next/image";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth";
import { getCartCount, getWishlistCount, getUnreadNotificationCount } from "@/lib/marketplace";
import { signOutAction } from "@/app/(auth)/actions";

export async function MarketplaceHeader() {
  const profile = await getCurrentProfile();

  const [cartCount, wishlistCount, notificationCount] = profile
    ? await Promise.all([getCartCount(profile.id), getWishlistCount(profile.id), getUnreadNotificationCount(profile.id)])
    : [0, 0, 0];

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/marketplace" className="flex-shrink-0">
          <Image src="/onlib-logo.jpg" alt="ONLib" width={120} height={40} className="h-9 w-auto object-contain" priority />
        </Link>

        <form action="/marketplace/search" className="hidden flex-1 sm:block">
          <input
            type="search"
            name="q"
            placeholder="Search products, stores…"
            className="w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm focus:border-brand-blue focus:outline-none"
          />
        </form>

        <nav className="ml-auto flex items-center gap-4 text-sm">
          <Link href="/marketplace/wishlist" className="relative text-slate-500 hover:text-brand-red" aria-label="Wishlist">
            <HeartIcon />
            {wishlistCount > 0 ? <Badge count={wishlistCount} color="bg-brand-red" /> : null}
          </Link>
          <Link href="/marketplace/cart" className="relative text-slate-500 hover:text-brand-navy" aria-label="Cart">
            <CartIcon />
            {cartCount > 0 ? <Badge count={cartCount} color="bg-brand-blue" /> : null}
          </Link>
          <Link href="/marketplace/notifications" className="relative text-slate-500 hover:text-brand-navy" aria-label="Notifications">
            <BellIcon />
            {notificationCount > 0 ? <Badge count={notificationCount} color="bg-brand-red" /> : null}
          </Link>

          {profile ? (
            <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
              <div className="text-right leading-tight">
                <p className="font-semibold text-slate-800">{profile.full_name ?? "Account"}</p>
                <p className="text-xs capitalize text-slate-400">{profile.role}</p>
              </div>
              {profile.role === "vendor" ? (
                <Link href="/vendor/dashboard" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
                  Vendor
                </Link>
              ) : null}
              {profile.role === "admin" ? (
                <Link href="/admin" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">
                  Admin
                </Link>
              ) : null}
              <form action={signOutAction}>
                <button type="submit" className="text-xs font-medium text-slate-400 hover:text-brand-red">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <Link href="/login?next=/marketplace" className="rounded-lg bg-brand-navy px-4 py-2 font-semibold text-white hover:bg-slate-800">
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function Badge({ count, color }: { count: number; color: string }) {
  return (
    <span className={`absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full ${color} px-1 text-[10px] font-bold text-white`}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 21s-7-4.35-9.5-8.36C1 9.5 2 6 5.5 5c2-.55 3.86.28 4.9 1.9.14.22.55.22.7 0C12.14 5.28 14 4.45 16 5c3.5 1 4.5 4.5 3 7.64C19 16.65 12 21 12 21z" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M6 6h15l-1.5 9h-12z" />
      <path d="M6 6L5 3H2" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}
