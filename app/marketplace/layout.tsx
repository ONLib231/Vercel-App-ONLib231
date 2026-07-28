import { Sidebar } from "@/components/marketplace/Sidebar";
import { BottomTabBar } from "@/components/marketplace/BottomTabBar";
import { MarketplaceHeader } from "@/components/marketplace/MarketplaceHeader";
import { getHeaderCounts, getNavUser } from "@/lib/user";

/**
 * Shared chrome for every /marketplace/* route: desktop Sidebar, mobile
 * header + bottom tab bar. Fetched once per navigation here so individual
 * pages (homepage, category, product, etc.) only need their own content.
 */
export default async function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  const [navUser, counts] = await Promise.all([getNavUser(), getHeaderCounts()]);

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <Sidebar wishlistCount={counts.wishlist} user={navUser} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MarketplaceHeader user={navUser} counts={counts} />
        <main className="flex-1 pb-20 lg:pb-8">{children}</main>
      </div>

      <BottomTabBar wishlistCount={counts.wishlist} user={navUser} />
    </div>
  );
}
