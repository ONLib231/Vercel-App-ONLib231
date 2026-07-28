import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Tag, Zap, type LucideIcon } from "lucide-react";
import type { ServiceOptionViewModel } from "@/types/service";

const BADGE_ICONS: Record<ServiceOptionViewModel["badgeIcon"], LucideIcon> = {
  zap: Zap,
  tag: Tag,
};

const ACCENT_STYLES: Record<
  ServiceOptionViewModel["accent"],
  {
    title: string;
    badgeBg: string;
    badgeText: string;
    arrowBg: string;
    arrowIcon: string;
    imageBg: string;
    focusRing: string;
  }
> = {
  verta: {
    title: "text-verta-700",
    badgeBg: "bg-verta-50",
    badgeText: "text-verta-600",
    arrowBg: "bg-white border border-verta-100",
    arrowIcon: "text-verta-600",
    imageBg: "bg-verta-50",
    focusRing: "focus-visible:ring-verta-500",
  },
  onlib: {
    title: "text-onlib-600",
    badgeBg: "bg-onlib-50",
    badgeText: "text-onlib-600",
    arrowBg: "bg-white border border-onlib-100",
    arrowIcon: "text-onlib-600",
    imageBg: "bg-onlib-50",
    focusRing: "focus-visible:ring-onlib-500",
  },
};

export interface ServiceCardProps {
  option: ServiceOptionViewModel;
  /** Optional override, e.g. for analytics wrapping; defaults to option.route */
  href?: string;
}

/**
 * A single selectable service card ("Verta Delivery" / "ONLib Marketplace")
 * on the dual-service landing screen. Presentational + fully typed; all
 * copy and imagery are passed in as props so this component has no
 * knowledge of Supabase or data-fetching.
 */
export function ServiceCard({ option, href }: ServiceCardProps) {
  const styles = ACCENT_STYLES[option.accent];
  const BadgeIcon = BADGE_ICONS[option.badgeIcon];
  const destination = href ?? option.route;

  return (
    <Link
      href={destination}
      aria-label={`${option.title} — ${option.subtitle}`}
      className={`group flex items-center gap-4 rounded-xl2 border border-slate-100 bg-white p-4 shadow-sm
        transition hover:-translate-y-0.5 hover:shadow-md
        focus-visible:outline-none focus-visible:ring-2 ${styles.focusRing}
        sm:p-5`}
    >
      <div
        className={`relative h-24 w-24 shrink-0 overflow-hidden rounded-lg ${styles.imageBg} sm:h-28 sm:w-28`}
      >
        <Image
          src={option.imageUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 96px, 112px"
          className="object-contain p-2"
          priority={false}
        />
      </div>

      <div className="min-w-0 flex-1">
        <h2 className={`text-lg font-bold sm:text-xl ${styles.title}`}>{option.title}</h2>
        <p className="mt-0.5 text-sm text-slate-500 sm:text-base">{option.subtitle}</p>

        <span
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium sm:text-sm ${styles.badgeBg} ${styles.badgeText}`}
        >
          <BadgeIcon className="h-3.5 w-3.5" aria-hidden />
          {option.badgeLabel}
        </span>
      </div>

      <div
        className={`tap-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${styles.arrowBg} transition group-hover:translate-x-0.5`}
      >
        <ArrowRight className={`h-5 w-5 ${styles.arrowIcon}`} aria-hidden />
      </div>
    </Link>
  );
}
