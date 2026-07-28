import { notFound } from "next/navigation";
import { getCategoryBySlug, getProductsByCategoryId } from "@/lib/marketplace";
import { ProductCard } from "@/components/product-card";

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const products = await getProductsByCategoryId(category.id);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">{category.name}</h1>
      {products.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          No products in this category yet.
        </p>
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
