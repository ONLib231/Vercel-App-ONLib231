import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductCard } from "@/components/product-card";
import type { Store, Product } from "@/lib/marketplace";

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: store }: { data: Store | null } = await supabase.from("stores").select("*").eq("slug", slug).eq("is_active", true).maybeSingle();
  if (!store) notFound();

  const { data: products }: { data: Product[] | null } = await supabase
    .from("products")
    .select("*")
    .eq("store_id", store.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white" style={{ backgroundColor: store.avatar_color }}>
          {store.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{store.name}</h1>
          <p className="text-sm text-amber-500">
            ★ {store.rating_avg.toFixed(1)} <span className="text-slate-400">({store.rating_count} reviews)</span>
          </p>
        </div>
      </div>

      {!products || products.length === 0 ? (
        <p className="card p-8 text-center text-sm text-slate-400">This store hasn&rsquo;t listed any products yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
