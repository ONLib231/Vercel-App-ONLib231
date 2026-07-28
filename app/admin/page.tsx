import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Deliberately five separate, fully-typed count queries rather than one
// generic helper parameterized over table name: a generic `.from(table)`
// helper needs an unsafe cast against @supabase/postgrest-js's generics
// (which is exactly the kind of "looks fine, breaks the real compiler"
// pattern this codebase avoids — see the note atop database.types.ts).
export default async function AdminOverviewPage() {
  const supabase = await createClient();

  const [pendingApplicationsResult, storesResult, marketplaceOrdersResult, deliveryOrdersResult, pendingDeliveriesResult] = await Promise.all([
    supabase.from("vendor_applications").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("stores").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("*", { count: "exact", head: true }),
    supabase.from("delivery_orders").select("*", { count: "exact", head: true }),
    supabase.from("delivery_orders").select("*", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const cards: { label: string; value: number; href: string }[] = [
    { label: "Pending vendor applications", value: pendingApplicationsResult.count ?? 0, href: "/admin/vendor-applications" },
    { label: "Active stores", value: storesResult.count ?? 0, href: "/admin/vendor-applications" },
    { label: "Marketplace orders", value: marketplaceOrdersResult.count ?? 0, href: "/admin/orders" },
    { label: "Delivery orders", value: deliveryOrdersResult.count ?? 0, href: "/admin/delivery" },
    { label: "Delivery orders awaiting pickup", value: pendingDeliveriesResult.count ?? 0, href: "/admin/delivery" },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.label} href={card.href} className="card p-5 transition hover:shadow-md">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{card.value}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
