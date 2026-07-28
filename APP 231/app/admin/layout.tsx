import { redirect } from "next/navigation";
import { getNavUser } from "@/lib/user";
import { getPlatformStats } from "@/lib/super-admin";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminBottomTabBar } from "@/components/admin/AdminBottomTabBar";

/**
 * Shared chrome for every /admin/* route — the Super Admin panel every
 * earlier migration flagged as "not yet built" (0004/0005's vendor
 * application comments). Gated to profiles.role === 'admin', the same tier
 * that already runs the Delivery admin dashboard (/delivery/admin) and
 * already has write access to categories/stores/products/service_options.
 * There's no separate "Super Admin" role in the database — see
 * supabase/migrations/0007_super_admin_module.sql's header for the
 * one-time SQL bootstrap step that promotes the first account.
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const navUser = await getNavUser();
  if (!navUser) {
    redirect("/login?next=/admin");
    return null;
  }
  if (navUser.role !== "admin") {
    redirect("/marketplace");
    return null;
  }

  const stats = await getPlatformStats();

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <AdminSidebar pendingVendorApplications={stats.pendingVendorApplications} />

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader user={navUser} />
        <main className="flex-1 pb-20 lg:pb-8">{children}</main>
      </div>

      <AdminBottomTabBar />
    </div>
  );
}
