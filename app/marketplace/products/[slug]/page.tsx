import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/marketplace";
import { addToCartAction, toggleWishlistAction } from "@/app/marketplace/actions";
import { formatCents } from "@/lib/utils";

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <div className="aspect-square overflow-hidden rounded-2xl bg-slate-100">
        {product.image_path ? (
          <Image src={product.image_path} alt={product.name} width={600} height={600} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">No image</div>
        )}
      </div>

      <div>
        {product.store ? (
          <Link href={`/marketplace/stores/${product.store.slug}`} className="text-sm font-medium text-brand-blue hover:underline">
            {product.store.name}
          </Link>
        ) : null}
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{product.name}</h1>
        {product.rating_count > 0 ? (
          <p className="mt-1 text-sm text-amber-500">
            {"★".repeat(Math.round(product.rating_avg))}
            {"☆".repeat(5 - Math.round(product.rating_avg))}{" "}
            <span className="text-slate-400">({product.rating_count} reviews)</span>
          </p>
        ) : null}
        <p className="mt-4 text-3xl font-bold text-slate-900">{formatCents(product.price_cents, product.currency)}</p>
        {product.description ? <p className="mt-4 text-sm leading-relaxed text-slate-600">{product.description}</p> : null}

        <div className="mt-6 flex gap-3">
          <form action={addToCartAction} className="flex-1">
            <input type="hidden" name="product_id" value={product.id} />
            <button type="submit" className="btn-primary">
              Add to Cart
            </button>
          </form>
          <form action={toggleWishlistAction}>
            <input type="hidden" name="product_id" value={product.id} />
            <button type="submit" className="btn-secondary px-4" aria-label="Toggle wishlist">
              ♡
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
