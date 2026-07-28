import { redirect } from "next/navigation";
import { getNavUser } from "@/lib/user";
import { DeliveryAdminSidebar } from "@/components/delivery/admin/DeliveryAdminSidebar";
import { DeliveryAdminHeader } from "@/components/delivery/admin/DeliveryAdminHeader";
import { DeliveryAdminBottomTabBar } from "@/components/delivery/admin/DeliveryAdminBottomTabBar";

/**
 * Shared chrome for every /delivery/admin/* route, gated to
 * profiles.role === 'admin' — the same admin tier used for Marketplace's
 * admin-write policies (0001/0002 migrations), not a separate Delivery-only
 * login the original standalone app had. A signed-in non-admin who lands
 * here (e.g. by URL) is bounced back to the sender view instead.
 */
export default async function DeliveryAdminLayout({ children }: { children: React.ReactNode }) {
  const navUser = await getNavUser();
  if (!navUser) {
    redirect("/login?next=/delivery/admin");
    return null;
  }
  if (navUser.role !== "admin") {
    redirect("/delivery");
    return null;
  }

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <DeliveryAdminSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <DeliveryAdminHeader user={navUser} />
        <main className="flex-1 pb-20 lg:pb-8">{children}</main>
      </div>

      <DeliveryAdminBottomTabBar />
    </div>
  );
}
