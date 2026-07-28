"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, LogIn, ShoppingCart } from "lucide-react";
import type { ProductViewModel } from "@/types/marketplace";
import { addToCart } from "@/lib/actions/cart";
import { getCatalogIcon } from "./icon-map";
import { RatingBadge } from "./RatingBadge";

export interface ProductCardProps {
  product: ProductViewModel;
  /**
   * Guests can browse every product, but adding to cart requires an
   * account — when false, the CTA becomes a "Login to Shop" link instead
   * of attempting the cart action. Passed down from the page (see
   * lib/user.ts#isSignedIn) rather than checked in this component so the
   * card itself doesn't need to know about auth/session details.
   */
  isSignedIn: boolean;
}

export function ProductCard({ product, isSignedIn }: ProductCardProps) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "added" | "sign_in_required" | "error">("idle");
  const CategoryIcon = getCatalogIcon(product.categoryIcon);

  function handleAddToCart() {
    startTransition(async () => {
      const result = await addToCart(product.id);
      if (result.ok) {
        setStatus("added");
      } else if (result.error === "sign_in_required") {
        setStatus("sign_in_required");
      } else {
        setStatus("error");
      }
      setTimeout(() => setStatus("idle"), 2500);
    });
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <Link href={product.href} className="relative block aspect-square w-full bg-slate-50">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, 220px"
            className="object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <CategoryIcon className="h-10 w-10 text-slate-300" aria-hidden />
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Link href={product.href} className="line-clamp-2 text-sm font-semibold text-slate-800 hover:text-verta-700">
          {product.name}
        </Link>
        <p className="text-base font-bold text-slate-900">{product.priceLabel}</p>
        <RatingBadge average={product.ratingAvg} count={product.ratingCount} />

        {isSignedIn ? (
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={isPending}
            aria-live="polite"
            className="tap-target mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-verta-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-verta-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "added" ? (
              <Check className="h-4 w-4" aria-hidden />
            ) : (
              <ShoppingCart className="h-4 w-4" aria-hidden />
            )}
            {status === "added"
              ? "Added to Cart"
              : status === "sign_in_required"
                ? "Sign in to add"
                : status === "error"
                  ? "Try again"
                  : isPending
                    ? "Adding..."
                    : "Add to Cart"}
          </button>
        ) : (
          <Link
            href={`/login?next=/marketplace/products/${product.slug}`}
            className="tap-target mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-verta-200 bg-verta-50 px-3 py-2 text-sm font-semibold text-verta-700 transition hover:bg-verta-100"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Login to Shop
          </Link>
        )}
      </div>
    </div>
  );
}
