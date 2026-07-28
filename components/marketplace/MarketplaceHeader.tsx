import { Bell, ShoppingCart } from "lucide-react";
import type { HeaderCounts, NavUser } from "@/types/marketplace";
import { MarketplaceLogo } from "./MarketplaceLogo";
import { SearchBar } from "./SearchBar";
import { IconBadgeLink } from "./IconBadgeLink";
import { UserMenu } from "./UserMenu";

export interface MarketplaceHeaderProps {
  user: NavUser | null;
  counts: HeaderCounts;
}

/**
 * Top chrome for the marketplace section. Renders two distinct layouts by
 * breakpoint rather than reshuffling one row with CSS, because mobile and
 * desktop genuinely differ in content, not just column count:
 *  - Mobile (< lg): logo + cart/bell row, then a full-width search row.
 *    (Sidebar is hidden below lg, so the logo has to live here instead.)
 *  - Desktop (>= lg): single row — search, cart, notifications, user menu.
 *    No logo (it's already in the Sidebar) and no account for it here.
 */
export function MarketplaceHeader({ user, counts }: MarketplaceHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white">
      {/* Mobile */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3 lg:hidden">
        <MarketplaceLogo className="h-8 w-auto" />
        <div className="flex items-center gap-1">
          <IconBadgeLink href="/marketplace/cart" icon={ShoppingCart} label="Cart" count={counts.cart} />
          <IconBadgeLink href="/marketplace/notifications" icon={Bell} label="Notifications" count={counts.notifications} />
        </div>
      </div>
      <div className="px-4 py-3 lg:hidden">
        <SearchBar />
      </div>

      {/* Desktop */}
      <div className="hidden items-center gap-4 px-6 py-3 lg:flex">
        <SearchBar className="max-w-md" />
        <div className="flex flex-1 items-center justify-end gap-1">
          <IconBadgeLink href="/marketplace/cart" icon={ShoppingCart} label="Cart" count={counts.cart} showLabel />
          <IconBadgeLink
            href="/marketplace/notifications"
            icon={Bell}
            label="Notifications"
            count={counts.notifications}
            showLabel
          />
          <span className="mx-1 h-6 w-px bg-slate-100" aria-hidden />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
