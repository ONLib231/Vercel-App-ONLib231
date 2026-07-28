import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";

export interface ComingSoonProps {
  title: string;
  description: string;
  icon?: LucideIcon;
}

/**
 * Placeholder for Vendor Dashboard sections that are on the sidebar/tab bar
 * (matching the mockups) but not yet built out — Products, Orders,
 * Messages, Leads, Reports, Customers, Promotions, Settings. Keeps every
 * nav link real and reachable instead of 404ing, while being honest that
 * the full page isn't implemented yet.
 */
export function ComingSoon({ title, description, icon: Icon = Construction }: ComingSoonProps) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-16 text-center sm:px-6 lg:px-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-verta-50 text-verta-700">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="text-xl font-extrabold text-slate-900">{title}</h1>
      <p className="max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}
