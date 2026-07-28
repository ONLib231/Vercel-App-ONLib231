import { getCurrentProfile } from "@/lib/auth";
import { DeliveryOrderForm } from "./DeliveryOrderForm";

export default async function DeliveryPage({ searchParams }: { searchParams: Promise<{ placed?: string }> }) {
  const { placed } = await searchParams;
  const profile = await getCurrentProfile();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Send a package, on demand</h1>
      <p className="mb-6 text-sm text-slate-500">Fast. Reliable. Secure.</p>

      {placed ? (
        <div className="mb-6 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          Order placed — reference <span className="font-mono">{placed.slice(0, 8)}</span>. We&rsquo;ll be in touch to confirm pickup.
        </div>
      ) : null}

      <DeliveryOrderForm defaultName={profile?.full_name ?? undefined} />
    </div>
  );
}
