import { redirect } from "next/navigation";
import { getHeaderCounts, getNavUser } from "@/lib/user";
import { getVendorApplication, getVendorNavUser } from "@/lib/vendor";
import { VendorSidebar } from "@/components/vendor/VendorSidebar";
import { VendorHeader } from "@/components/vendor/VendorHeader";
import { VendorBottomTabBar } from "@/components/vendor/VendorBottomTabBar";

/**
 * Shared chrome for every /vendor/* route. Also where the actual gating
 * lives — middleware.ts only checks "is anyone signed in"; the
 * role/approval checks that decide whether THIS signed-in user gets a
 * Vendor Dashboard happen here, same pattern as the rest of this codebase
 * (component-level checks rather than an Edge DB round-trip per request).
 *
 * "Vendors are only identified by their login details" — there's no
 * separate vendor portal to visit; a customer who wanders into /vendor by
 * URL is bounced back to /marketplace, and a vendor whose application isn't
 * approved yet is bounced to /vendor/pending instead of seeing the
 * dashboard.
 */
export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const navUser = await getNavUser();
  if (!navUser) {
    redirect("/login?next=/vendor");
    return null;
  }
  if (navUser.role !== "vendor") {
    redirect("/marketplace");
    return null;
  }

  const application = await getVendorApplication();
  if (!application || application.status !== "approved") {
    redirect("/vendor/pending");
    return null;
  }

  const [vendorUser, counts] = await Promise.all([getVendorNavUser(), getHeaderCounts()]);

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <VendorSidebar messagesCount={0} />

      <div className="flex min-w-0 flex-1 flex-col">
        <VendorHeader user={vendorUser} notificationsCount={counts.notifications} />
        <main className="flex-1 pb-20 lg:pb-8">{children}</main>
      </div>

      <VendorBottomTabBar messagesCount={0} />
    </div>
  );
}
