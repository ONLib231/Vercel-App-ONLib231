import { MarketplaceHeader } from "@/components/marketplace-header";

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <MarketplaceHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
