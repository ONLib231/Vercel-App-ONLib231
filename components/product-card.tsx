import Link from "next/link";
import Image from "next/image";
import { formatCents } from "@/lib/utils";
import { addToCartAction } from "@/app/marketplace/actions";
import type { Product } from "@/lib/marketplace";

export function ProductCard({ product }: { product: Product }) {
  return (
    <div className="card flex flex-col overflow-hidden">
      <Link href={`/marketplace/products/${product.slug}`} className="block aspect-square bg-slate-100">
        {product.image_path ? (
          <Image src={product.image_path} alt={product.name} width={300} height={300} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <svg viewBox="0 0 24 24" className="h-10 w-10" fill="currentColor">
              <path d="M4 5h16v14H4zm2 2v10h12V7zm2 8l3-4 2 2 3-4 2 6H8z" />
            </svg>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link href={`/marketplace/products/${product.slug}`} className="text-sm font-medium text-slate-800 hover:text-brand-blue">
          {product.name}
        </Link>
        <p className="text-base font-bold text-slate-900">{formatCents(product.price_cents, product.currency)}</p>
        {product.rating_count > 0 ? (
          <p className="text-xs text-amber-500">
            {"★".repeat(Math.round(product.rating_avg))}
            {"☆".repeat(5 - Math.round(product.rating_avg))}{" "}
            <span className="text-slate-400">({product.rating_count})</span>
          </p>
        ) : null}
        <form action={addToCartAction} className="mt-auto pt-2">
          <input type="hidden" name="product_id" value={product.id} />
          <button type="submit" className="btn-primary py-2 text-xs">
            Add to Cart
          </button>
        </form>
      </div>
    </div>
  );
}
