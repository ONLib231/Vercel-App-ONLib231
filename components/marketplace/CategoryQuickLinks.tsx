import Link from "next/link";
import type { CategoryViewModel } from "@/types/marketplace";
import { getCatalogIcon } from "./icon-map";

export interface CategoryQuickLinksProps {
  categories: CategoryViewModel[];
  /** "row" = mobile, full-width strip below the hero banner.
   *  "grid" = desktop, 3-column grid beside the hero banner. */
  variant: "row" | "grid";
  className?: string;
}

function CategoryTile({ category }: { category: CategoryViewModel }) {
  const Icon = getCatalogIcon(category.icon);
  return (
    <Link
      href={category.href}
      className="tap-target flex flex-col items-center gap-1.5 rounded-xl border border-slate-100 bg-white px-3 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <Icon className="h-5 w-5 text-verta-600" aria-hidden />
      <span className="text-xs font-medium text-slate-600">{category.name}</span>
    </Link>
  );
}

export function CategoryQuickLinks({ categories, variant, className = "" }: CategoryQuickLinksProps) {
  if (variant === "row") {
    return (
      <div className={`grid grid-cols-5 gap-2 ${className}`}>
        {categories.map((category) => (
          <CategoryTile key={category.id} category={category} />
        ))}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-3 gap-3 ${className}`}>
      {categories.map((category) => (
        <CategoryTile key={category.id} category={category} />
      ))}
    </div>
  );
}
