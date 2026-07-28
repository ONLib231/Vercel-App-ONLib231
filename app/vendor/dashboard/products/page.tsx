import { requireApprovedVendor } from "@/lib/auth";
import { getStoreProducts } from "@/lib/vendor-dashboard";
import { getActiveCategories } from "@/lib/marketplace";
import { formatCents } from "@/lib/utils";
import { toggleProductActiveAction, deleteProductAction } from "./actions";
import { ProductForm } from "./ProductForm";

export default async function VendorProductsPage() {
  const { store } = await requireApprovedVendor();
  const [products, categories] = await Promise.all([getStoreProducts(store.id), getActiveCategories()]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Products</h1>

      <ProductForm categories={categories} />

      <div className="card divide-y divide-slate-100">
        {products.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No products yet — add your first one above.</p>
        ) : (
          products.map((product) => (
            <div key={product.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium text-slate-800">{product.name}</p>
                <p className="text-sm text-slate-500">{formatCents(product.price_cents, product.currency)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`badge ${product.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                  {product.is_active ? "Active" : "Hidden"}
                </span>
                <form action={toggleProductActiveAction}>
                  <input type="hidden" name="product_id" value={product.id} />
                  <input type="hidden" name="is_active" value={String(product.is_active)} />
                  <button type="submit" className="text-xs font-medium text-brand-blue hover:underline">
                    {product.is_active ? "Hide" : "Activate"}
                  </button>
                </form>
                <form action={deleteProductAction}>
                  <input type="hidden" name="product_id" value={product.id} />
                  <button type="submit" className="text-xs font-medium text-brand-red hover:underline">
                    Delete
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
