import { createClient } from "@/lib/supabase/server";
import { ProductCard } from "@/components/product-card";
import type { Product } from "@/lib/marketplace";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  let products: Product[] = [];
  if (query) {
    const supabase = await createClient();
    const { data }: { data: Product[] | null } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .ilike("name", `%${query}%`)
      .limit(24);
    products = data ?? [];
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{query ? `Results for "${query}"` : "Search"}</h1>
      {query && products.length === 0 ? <p className="card p-8 text-center text-sm text-slate-400">No products matched.</p> : null}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
