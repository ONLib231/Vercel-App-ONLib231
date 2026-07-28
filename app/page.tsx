import { ServiceSelector } from "@/components/marketing/ServiceSelector";
import { getServiceOptions } from "@/lib/services";

/**
 * Default homepage: the dual-service landing / role-selector screen.
 * Data-driven from Supabase (public.service_options) with a static
 * fallback baked into getServiceOptions() if the DB is unreachable.
 */
export default async function HomePage() {
  const options = await getServiceOptions();

  return <ServiceSelector options={options} />;
}
