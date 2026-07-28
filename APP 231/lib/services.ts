import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceOptionViewModel } from "@/types/service";

const ASSET_BUCKET = "app-assets";

/**
 * Static fallback shown if Supabase is unreachable or the table is empty
 * (e.g. local dev before the project is provisioned). Keeps the landing
 * screen from ever rendering blank.
 */
const FALLBACK_SERVICE_OPTIONS: ServiceOptionViewModel[] = [
  {
    key: "delivery",
    title: "Verta Delivery",
    subtitle: "Send a package, on demand",
    badgeLabel: "Fast. Reliable. Secure.",
    badgeIcon: "zap",
    imageUrl: "/images/services/verta-delivery-hero.png",
    accent: "verta",
    route: "/delivery",
  },
  {
    key: "marketplace",
    title: "ONLib Marketplace",
    subtitle: "Shop products from real vendors",
    badgeLabel: "Quality. Trusted. Convenient.",
    badgeIcon: "tag",
    imageUrl: "/images/services/onlib-marketplace-hero.png",
    accent: "onlib",
    route: "/marketplace",
  },
];

/**
 * Fetches the active service cards for the dual-service landing screen,
 * ordered for display, with resolved public Storage image URLs.
 *
 * Falls back to static defaults on any error so the screen degrades
 * gracefully instead of crashing (no user should see a broken landing page).
 */
export async function getServiceOptions(): Promise<ServiceOptionViewModel[]> {
  try {
    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase
      .from("service_options")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[getServiceOptions] Supabase query failed:", error.message);
      return FALLBACK_SERVICE_OPTIONS;
    }

    if (!data || data.length === 0) {
      return FALLBACK_SERVICE_OPTIONS;
    }

    return data.map((row) => {
      const {
        data: { publicUrl },
      } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(row.image_path);

      return {
        key: row.key,
        title: row.title,
        subtitle: row.subtitle,
        badgeLabel: row.badge_label,
        badgeIcon: row.badge_icon,
        imageUrl: publicUrl,
        accent: row.accent,
        route: row.route,
      } satisfies ServiceOptionViewModel;
    });
  } catch (err) {
    console.error("[getServiceOptions] Unexpected failure:", err);
    return FALLBACK_SERVICE_OPTIONS;
  }
}
