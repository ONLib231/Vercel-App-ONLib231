import Image from "next/image";
import Link from "next/link";

export interface MarketplaceLogoProps {
  src?: string;
  alt?: string;
  href?: string;
  className?: string;
}

/**
 * Compact ONLib wordmark used in the sidebar (desktop) and the mobile
 * marketplace header. Same source asset as the landing screen's header
 * logo — see components/marketing/ServiceSelector.tsx — kept as its own
 * component here since sizing/placement differs per surface.
 */
export function MarketplaceLogo({
  src = "/images/logos/onlib-logo-full.jpeg",
  alt = "ONLib — Shop & Delivery",
  href = "/marketplace",
  className = "h-9 w-auto sm:h-10",
}: MarketplaceLogoProps) {
  return (
    <Link href={href} className="flex items-center" aria-label={alt}>
      <Image src={src} alt={alt} width={192} height={120} className={`object-contain ${className}`} priority />
    </Link>
  );
}
