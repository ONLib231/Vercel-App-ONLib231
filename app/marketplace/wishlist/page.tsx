import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getWishlistItems } from "@/lib/marketplace";
import { ProductCard } from "@/components/product-card";

export default async function WishlistPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/marketplace/wishlist");

  const items = await getWishlistItems(profile.id);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Your Wishlist</h1>

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-500">Nothing saved yet.</p>
          <Link href="/marketplace" className="mt-4 inline-block font-semibold text-brand-blue hover:underline">
            Browse products
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <ProductCard key={item.id} product={item.product} />
          ))}
        </div>
      )}
    </div>
  );
}
