import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export interface IconBadgeLinkProps {
  href: string;
  icon: LucideIcon;
  label: string;
  count?: number;
  /** Show the text label next to the icon (desktop); mobile passes false. */
  showLabel?: boolean;
  active?: boolean;
  className?: string;
}

/**
 * Icon button with an optional numeric badge — the cart / notifications
 * icons in the header, and the wishlist icon in the bottom tab bar / sidebar.
 */
export function IconBadgeLink({
  href,
  icon: Icon,
  label,
  count,
  showLabel = false,
  active = false,
  className = "",
}: IconBadgeLinkProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`tap-target relative flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-slate-100 ${
        active ? "text-verta-600" : "text-slate-500"
      } ${className}`}
    >
      <span className="relative">
        <Icon className="h-5 w-5" aria-hidden />
        {!!count && count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-onlib-600 px-1 text-[10px] font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      {showLabel && <span className="font-medium">{label}</span>}
    </Link>
  );
}
