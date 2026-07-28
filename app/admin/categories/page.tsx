import { getActiveCategories } from "@/lib/marketplace";
import { createClient } from "@/lib/supabase/server";
import { toggleCategoryActiveAction, deleteCategoryAction } from "./actions";
import { CategoryForm } from "./CategoryForm";
import type { Tables } from "@/lib/supabase/database.types";

export default async function CategoriesAdminPage() {
  const supabase = await createClient();
  const { data: categories }: { data: Tables<"categories">[] | null } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Categories</h1>

      <CategoryForm />

      <div className="card divide-y divide-slate-100">
        {(categories ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">No categories yet.</p>
        ) : (
          (categories ?? []).map((category) => (
            <div key={category.id} className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-2">
                <span>{category.icon}</span>
                <span className="font-medium text-slate-800">{category.name}</span>
                <span className="text-xs text-slate-400">/{category.slug}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`badge ${category.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                  {category.is_active ? "Active" : "Hidden"}
                </span>
                <form action={toggleCategoryActiveAction}>
                  <input type="hidden" name="category_id" value={category.id} />
                  <input type="hidden" name="is_active" value={String(category.is_active)} />
                  <button type="submit" className="text-xs font-medium text-brand-blue hover:underline">
                    {category.is_active ? "Hide" : "Activate"}
                  </button>
                </form>
                <form action={deleteCategoryAction}>
                  <input type="hidden" name="category_id" value={category.id} />
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
