import Link from "next/link";
import { BarChart3, ClipboardCheck, PlusCircle, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface QuickAction {
  href: string;
  label: string;
  icon: LucideIcon;
  accent: string;
}

const ACTIONS: QuickAction[] = [
  { href: "/vendor/products/new", label: "Add Product", icon: PlusCircle, accent: "bg-verta-600 text-white" },
  { href: "/vendor/products", label: "Check Inventory", icon: ClipboardCheck, accent: "bg-onlib-50 text-onlib-600" },
  { href: "/vendor/promotions", label: "Manage Promos", icon: Tag, accent: "bg-verta-50 text-verta-700" },
  { href: "/vendor/reports", label: "View Reports", icon: BarChart3, accent: "bg-onlib-50 text-onlib-600" },
];

/** "Quick Actions" grid on the Vendor Dashboard home. */
export function QuickActionsGrid() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:p-5">
      <p className="mb-3 text-sm font-semibold text-slate-700">Quick Actions</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center gap-2 rounded-xl border border-slate-100 px-3 py-4 text-center transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${action.accent}`}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-xs font-medium text-slate-600">{action.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
