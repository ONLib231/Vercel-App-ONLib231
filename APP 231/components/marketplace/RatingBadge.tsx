import { Star } from "lucide-react";

export interface RatingBadgeProps {
  average: number;
  count?: number;
  className?: string;
}

/**
 * Compact "★ 4.8 (128)" rating readout used on product and store cards.
 * `count` is omitted for stores in the mockup (just the average shows),
 * so it's optional here.
 */
export function RatingBadge({ average, count, className = "" }: RatingBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-slate-500 ${className}`}>
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
      <span className="font-medium text-slate-700">{average.toFixed(1)}</span>
      {typeof count === "number" && <span>({count})</span>}
    </span>
  );
}
