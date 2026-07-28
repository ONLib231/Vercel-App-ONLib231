import Link from "next/link";
import { getActiveCategories, getFeaturedProducts, getPopularStores } from "@/lib/marketplace";
import { ProductCard } from "@/components/product-card";

const CATEGORY_ICONS: Record<string, string> = {
  electronics: "🖥️",
  home: "🏠",
  fashion: "👗",
  beauty: "💄",
  more: "⊞",
};

export default async function MarketplaceHomePage() {
  const [categories, featured, stores] = await Promise.all([getActiveCategories(), getFeaturedProducts(), getPopularStores()]);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 rounded-2xl bg-gradient-to-r from-brand-navy to-slate-900 p-8 text-white sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-300">Discover</p>
          <h1 className="mt-1 text-3xl font-bold sm:text-4xl">
            Amazing <span className="text-brand-red">Products</span>
          </h1>
          <p className="mt-2 max-w-md text-slate-300">Shop the best, delivered to your door.</p>
          <Link href="#featured" className="mt-4 inline-block rounded-lg bg-brand-red px-5 py-2.5 font-semibold hover:bg-red-700">
            Shop Now
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {categories.map((category) => (
          <Link
            key={category.id}
            href={`/marketplace/categories/${category.slug}`}
            className="card flex flex-col items-center gap-2 p-4 text-center hover:shadow-md"
          >
            <span className="text-2xl">{CATEGORY_ICONS[category.slug] ?? "⊞"}</span>
            <span className="text-xs font-medium text-slate-700">{category.name}</span>
          </Link>
        ))}
      </section>

      <section id="featured">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Featured Products</h2>
        </div>
        {featured.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            No featured products yet — check back soon.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {featured.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Popular Stores</h2>
        </div>
        {stores.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">No stores yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {stores.map((store) => (
              <div key={store.id} className="card flex flex-col items-center gap-2 p-4 text-center">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white"
                  style={{ backgroundColor: store.avatar_color }}
                >
                  {store.name.slice(0, 2).toUpperCase()}
                </div>
                <p className="text-sm font-medium text-slate-800">{store.name}</p>
                <p className="text-xs text-amber-500">★ {store.rating_avg.toFixed(1)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
