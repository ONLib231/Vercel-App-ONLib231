"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createProductAction, type ProductFormState } from "./actions";
import type { Category } from "@/lib/marketplace";

const initialState: ProductFormState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary sm:w-auto sm:px-6" disabled={pending}>
      {pending ? "Adding…" : "Add product"}
    </button>
  );
}

export function ProductForm({ categories }: { categories: Category[] }) {
  const [state, formAction] = useFormState(createProductAction, initialState);

  return (
    <form action={formAction} className="card grid gap-4 p-5 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="name">
          Product name
        </label>
        <input id="name" name="name" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="price">
          Price (USD)
        </label>
        <input id="price" name="price" type="number" min="0" step="0.01" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="category_id">
          Category
        </label>
        <select id="category_id" name="category_id" className="input" defaultValue="">
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="description">
          Description
        </label>
        <textarea id="description" name="description" rows={2} className="input" />
      </div>
      {state.error ? <p className="sm:col-span-2 text-sm text-brand-red">{state.error}</p> : null}
      <div className="sm:col-span-2">
        <SubmitButton />
      </div>
    </form>
  );
}
