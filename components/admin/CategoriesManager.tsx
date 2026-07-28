"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { deleteCategory, saveCategory } from "@/lib/actions/super-admin";
import type { CategoryRow } from "@/types/marketplace";

export interface CategoriesManagerProps {
  categories: CategoryRow[];
}

export function CategoriesManager({ categories }: CategoriesManagerProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [icon, setIcon] = useState("grid");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveCategory({ name, slug, icon, sortOrder: categories.length, isActive: true });
      if (!result.ok) {
        setError(result.error ?? "Couldn't add this category.");
        return;
      }
      setName("");
      setSlug("");
      setIcon("grid");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="min-w-[140px] flex-1">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="e.g. Groceries"
          />
        </div>
        <div className="min-w-[120px]">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Slug</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="groceries"
          />
        </div>
        <div className="min-w-[110px]">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Icon</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="grid"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-full bg-verta-600 px-4 py-2 text-sm font-semibold text-white hover:bg-verta-700 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add
        </button>
      </form>

      {error && <p className="text-sm text-onlib-600">{error}</p>}

      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-sm">
        {categories.map((category) => (
          <CategoryRowItem key={category.id} category={category} />
        ))}
        {categories.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-400">No categories yet.</li>}
      </ul>
    </div>
  );
}

function CategoryRowItem({ category }: { category: CategoryRow }) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(category.is_active);
  const [isPending, startTransition] = useTransition();

  function toggleActive() {
    const next = !isActive;
    setIsActive(next);
    startTransition(async () => {
      await saveCategory({
        id: category.id,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        sortOrder: category.sort_order,
        isActive: next,
      });
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteCategory(category.id);
      router.refresh();
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-slate-800">{category.name}</p>
        <p className="text-xs text-slate-400">/{category.slug} · icon: {category.icon}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={toggleActive}
          disabled={isPending}
          className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60 ${
            isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {isActive ? "Active" : "Hidden"}
        </button>
        <button onClick={handleDelete} disabled={isPending} className="text-slate-400 hover:text-onlib-600 disabled:opacity-60">
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}
