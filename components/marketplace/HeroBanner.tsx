"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export interface HeroSlide {
  id: string;
  eyebrow: string;
  highlight: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  /** Optional promo graphic (Storage URL or local placeholder); the banner
   *  reads fine on the gradient alone when this isn't supplied yet. */
  imageUrl?: string;
}

export interface HeroBannerProps {
  slides: HeroSlide[];
  autoRotateMs?: number;
}

/**
 * The "DISCOVER AMAZING PRODUCTS" promo carousel at the top of the
 * marketplace homepage. Content is data-driven (`slides`) so a future
 * promos/campaigns table can swap copy and imagery without touching this
 * component — see app/marketplace/page.tsx for the seed content used
 * until that table exists.
 */
export function HeroBanner({ slides, autoRotateMs = 6000 }: HeroBannerProps) {
  const [index, setIndex] = useState(0);
  const count = slides.length;

  const goTo = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);

  useEffect(() => {
    if (count <= 1 || !autoRotateMs) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), autoRotateMs);
    return () => clearInterval(timer);
  }, [count, autoRotateMs]);

  const slide = slides[index];
  if (!slide) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Promotions"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-verta-900 via-verta-700 to-verta-600 px-6 py-8 text-white sm:px-10 sm:py-12"
    >
      <div className="flex items-center justify-between gap-6">
        <div className="max-w-md">
          <p className="text-xs font-bold uppercase tracking-widest text-white/70 sm:text-sm">{slide.eyebrow}</p>
          <h2 className="mt-1 text-2xl font-extrabold leading-tight text-onlib-400 sm:text-3xl">
            {slide.highlight}
          </h2>
          <p className="mt-3 text-sm text-white/80 sm:text-base">{slide.subtitle}</p>
          <Link
            href={slide.ctaHref}
            className="tap-target mt-5 inline-flex items-center justify-center rounded-full bg-onlib-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-onlib-700"
          >
            {slide.ctaLabel}
          </Link>
        </div>

        {slide.imageUrl && (
          <div className="relative hidden h-32 w-40 shrink-0 sm:block sm:h-40 sm:w-56">
            <Image src={slide.imageUrl} alt="" fill className="object-contain" sizes="224px" />
          </div>
        )}
      </div>

      {count > 1 && (
        <div className="mt-6 flex items-center gap-1.5" role="tablist" aria-label="Promotion slides">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Show slide ${i + 1}: ${s.highlight}`}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/60"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
