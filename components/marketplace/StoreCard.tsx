import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import type { StoreViewModel } from "@/types/marketplace";

export interface StoreCardProps {
  store: StoreViewModel;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function StoreCard({ store }: StoreCardProps) {
  return (
    <Link
      href={store.href}
      className="flex flex-col items-center gap-2 rounded-xl border border-slate-100 bg-white p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <span
        className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-lg font-bold text-white"
        style={{ backgroundColor: store.logoUrl ? undefined : store.avatarColor }}
      >
        {store.logoUrl ? (
          <Image src={store.logoUrl} alt={store.name} fill sizes="56px" className="object-cover" />
        ) : (
          initialsFor(store.name)
        )}
      </span>
      <span className="text-sm font-semibold text-slate-800">{store.name}</span>
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
        {store.ratingAvg.toFixed(1)}
      </span>
    </Link>
  );
}
