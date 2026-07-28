import { HeroBanner, type HeroSlide } from "@/components/marketplace/HeroBanner";
import { CategoryQuickLinks } from "@/components/marketplace/CategoryQuickLinks";
import { SectionHeader } from "@/components/marketplace/SectionHeader";
import { ProductCard } from "@/components/marketplace/ProductCard";
import { StoreCard } from "@/components/marketplace/StoreCard";
import { getCategories, getFeaturedProducts, getPopularStores } from "@/lib/marketplace";
import { isSignedIn } from "@/lib/user";

/**
 * Sample promo copy until a `promos`/campaigns table exists to drive this
 * from Supabase — structurally identical to how service_options replaced
 * hardcoded landing-screen copy, just not built yet for marketing banners.
 */
const HERO_SLIDES: HeroSlide[] = [
  {
    id: "discover",
    eyebrow: "Discover",
    highlight: "Amazing Products",
    subtitle: "Shop the best, delivered to your door.",
    ctaLabel: "Shop Now",
    ctaHref: "/marketplace/products",
    imageUrl: "/images/services/onlib-marketplace-hero.png",
  },
  {
    id: "new-arrivals",
    eyebrow: "New Arrivals",
    highlight: "Fresh Finds Weekly",
    subtitle: "New vendors and products added every week.",
    ctaLabel: "Explore New",
    ctaHref: "/marketplace/products?sort=new",
  },
  {
    id: "fast-delivery",
    eyebrow: "Fast & Reliable",
    highlight: "Delivered In Hours",
    subtitle: "Verta couriers get your order there fast.",
    ctaLabel: "Learn More",
    ctaHref: "/delivery",
  },
];

export default async function MarketplaceHomePage() {
  const [categories, featuredProducts, popularStores, signedIn] = await Promise.all([
    getCategories(),
    getFeaturedProducts(),
    getPopularStores(),
    isSignedIn(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="flex-1">
          <HeroBanner slides={HERO_SLIDES} />
        </div>
        <CategoryQuickLinks categories={categories} variant="grid" className="hidden lg:grid lg:w-72 lg:shrink-0" />
      </div>

      <CategoryQuickLinks categories={categories} variant="row" className="mt-4 lg:hidden" />

      <section className="mt-8">
        <SectionHeader title="Featured Products" viewAllHref="/marketplace/products" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {featuredProducts.map((product) => (
            <ProductCard key={product.id} product={product} isSignedIn={signedIn} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader title="Popular Stores" viewAllHref="/marketplace/stores" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {popularStores.map((store) => (
            <StoreCard key={store.id} store={store} />
          ))}
        </div>
      </section>
    </div>
  );
}
