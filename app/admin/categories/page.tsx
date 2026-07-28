import type { Metadata } from "next";
import { getAllCategoriesForAdmin } from "@/lib/super-admin";
import { CategoriesManager } from "@/components/admin/CategoriesManager";

export const metadata: Metadata = {
  title: "Categories — Super Admin",
};

export default async function CategoriesPage() {
  const categories = await getAllCategoriesForAdmin();

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Categories</h1>
        <p className="text-sm text-slate-500">Quick-link tiles on the Marketplace homepage. Hidden categories stay in the database but drop off the page.</p>
      </div>

      <CategoriesManager categories={categories} />
    </div>
  );
}
