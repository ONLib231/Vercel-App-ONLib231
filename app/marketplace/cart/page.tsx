import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getCartItems } from "@/lib/marketplace";
import { updateCartQuantityAction, removeFromCartAction } from "@/app/marketplace/actions";
import { formatCents } from "@/lib/utils";

export default async function CartPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/marketplace/cart");

  const items = await getCartItems(profile.id);
  const total = items.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Your Cart</h1>

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-slate-500">Your cart is empty.</p>
          <Link href="/marketplace" className="mt-4 inline-block font-semibold text-brand-blue hover:underline">
            Continue shopping
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="card flex items-center gap-4 p-4">
              <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-slate-100" />
              <div className="flex-1">
                <p className="font-medium text-slate-800">{item.product.name}</p>
                <p className="text-sm text-slate-500">{formatCents(item.product.price_cents, item.product.currency)}</p>
              </div>
              <form action={updateCartQuantityAction} className="flex items-center gap-2">
                <input type="hidden" name="item_id" value={item.id} />
                <input type="hidden" name="quantity" value={item.quantity - 1} />
                <button type="submit" className="h-7 w-7 rounded-full border border-slate-300 text-sm">
                  −
                </button>
              </form>
              <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
              <form action={updateCartQuantityAction}>
                <input type="hidden" name="item_id" value={item.id} />
                <input type="hidden" name="quantity" value={item.quantity + 1} />
                <button type="submit" className="h-7 w-7 rounded-full border border-slate-300 text-sm">
                  +
                </button>
              </form>
              <form action={removeFromCartAction}>
                <input type="hidden" name="item_id" value={item.id} />
                <button type="submit" className="text-xs font-medium text-brand-red hover:underline">
                  Remove
                </button>
              </form>
            </div>
          ))}

          <div className="card flex items-center justify-between p-4">
            <span className="font-semibold text-slate-700">Total</span>
            <span className="text-xl font-bold text-slate-900">{formatCents(total)}</span>
          </div>

          <button type="button" className="btn-primary" disabled title="Checkout not implemented in this build">
            Checkout (coming soon)
          </button>
        </div>
      )}
    </div>
  );
}
