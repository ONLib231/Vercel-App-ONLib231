import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getNavUser } from "@/lib/user";
import type {
  MarketplaceOrderOverviewItem,
  PlatformStats,
  UserManagementRow,
  VendorApplicationReviewItem,
} from "@/types/super-admin";
import type { CategoryRow } from "@/types/marketplace";
import type { ServiceOptionRow } from "@/types/service";
import type { VendorApplicationStatus } from "@/types/vendor";

/**
 * The single platform-wide admin tier (profiles.role = 'admin') — the same
 * one that already gates the Delivery admin dashboard (lib/delivery.ts#isDeliveryAdmin)
 * and the categories/service_options/stores/products admin-write RLS
 * policies from 0001/0002. There's one "admin" role, not a separate
 * Super-Admin-only tier.
 */
export async function isSuperAdmin(): Promise<boolean> {
  const navUser = await getNavUser();
  return navUser?.role === "admin";
}

/** Dashboard-home tiles: a bird's-eye count across every module. */
export async function getPlatformStats(): Promise<PlatformStats> {
  try {
    const supabase = createSupabaseServerClient();
    // profiles has no admin-wide select policy by design (0003 — a policy on
    // profiles that queries profiles recurses), so a regular-client count
    // here would silently return 1 (just the caller's own row) instead of
    // erroring. Service-role is the only way to get a real platform-wide count.
    const serviceRoleClient = createSupabaseServiceRoleClient();

    const [pending, approved, users, stores, marketplaceOrders, deliveryOrders] = await Promise.all([
      supabase.from("vendor_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("vendor_applications").select("id", { count: "exact", head: true }).eq("status", "approved"),
      serviceRoleClient.from("profiles").select("id", { count: "exact", head: true }),
      supabase.from("stores").select("id", { count: "exact", head: true }),
      supabase.from("orders").select("id", { count: "exact", head: true }),
      supabase.from("delivery_orders").select("id", { count: "exact", head: true }),
    ]);

    return {
      pendingVendorApplications: pending.count ?? 0,
      approvedVendors: approved.count ?? 0,
      totalUsers: users.count ?? 0,
      totalStores: stores.count ?? 0,
      totalMarketplaceOrders: marketplaceOrders.count ?? 0,
      totalDeliveryOrders: deliveryOrders.count ?? 0,
    };
  } catch (err) {
    console.error("[getPlatformStats] Unexpected failure:", err);
    return {
      pendingVendorApplications: 0,
      approvedVendors: 0,
      totalUsers: 0,
      totalStores: 0,
      totalMarketplaceOrders: 0,
      totalDeliveryOrders: 0,
    };
  }
}

/**
 * Vendor applications for the review queue, newest first, optionally
 * filtered by status. The application rows themselves use the regular
 * authenticated client — the vendor_applications_admin_select policy
 * (0007) is what makes this legal for a role='admin' session, same pattern
 * as categories/service_options. Two things about them still need
 * service-role, though: the applicant's profile (full_name/phone) — since
 * profiles has no admin-wide select policy by design (0003) — and the two
 * uploaded documents, since the "vendor-documents" bucket's storage policy
 * only lets the *owner* read their own files (0004), and generating a
 * signed URL for someone else's document is exactly what an admin
 * reviewing applications needs to do constantly.
 */
export async function getVendorApplications(
  statusFilter?: VendorApplicationStatus
): Promise<VendorApplicationReviewItem[]> {
  try {
    const supabase = createSupabaseServerClient();
    const serviceRoleClient = createSupabaseServiceRoleClient();
    let query = supabase.from("vendor_applications").select("*").order("submitted_at", { ascending: false });
    if (statusFilter) query = query.eq("status", statusFilter);

    const { data: applications, error } = await query;
    if (error) {
      console.error("[getVendorApplications] Supabase query failed:", error.message);
      return [];
    }
    if (!applications || applications.length === 0) return [];

    const userIds = applications.map((a) => a.user_id);
    // profiles has no admin-wide select policy by design (0003) — a regular
    // client here would silently return zero rows for every applicant other
    // than the admin themselves, so this goes through service-role too.
    const { data: applicantProfiles, error: profilesError } = await serviceRoleClient
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", userIds);
    if (profilesError) {
      console.error("[getVendorApplications] Failed to load applicant profiles:", profilesError.message);
    }
    const profileById = new Map((applicantProfiles ?? []).map((p) => [p.id, p]));

    const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes — long enough to review, short-lived by design
    const signedUrls = await Promise.all(
      applications.map(async (application) => {
        const [businessReg, idDoc] = await Promise.all([
          serviceRoleClient.storage
            .from("vendor-documents")
            .createSignedUrl(application.business_registration_path, SIGNED_URL_TTL_SECONDS),
          serviceRoleClient.storage.from("vendor-documents").createSignedUrl(application.id_document_path, SIGNED_URL_TTL_SECONDS),
        ]);
        if (businessReg.error) console.error("[getVendorApplications] Signed URL failed (business reg):", businessReg.error.message);
        if (idDoc.error) console.error("[getVendorApplications] Signed URL failed (id doc):", idDoc.error.message);
        return {
          businessRegistrationUrl: businessReg.data?.signedUrl ?? null,
          idDocumentUrl: idDoc.data?.signedUrl ?? null,
        };
      })
    );

    return applications.map((application, index) => ({
      ...application,
      applicantName: profileById.get(application.user_id)?.full_name ?? null,
      applicantPhone: profileById.get(application.user_id)?.phone ?? null,
      businessRegistrationUrl: signedUrls[index]?.businessRegistrationUrl ?? null,
      idDocumentUrl: signedUrls[index]?.idDocumentUrl ?? null,
    }));
  } catch (err) {
    console.error("[getVendorApplications] Unexpected failure:", err);
    return [];
  }
}

/**
 * Every signed-up account, newest first — Users & Roles page. profiles has
 * no admin-read RLS policy by design (see 0003's comment on recursion), and
 * profiles itself has no email column, so this goes through the service-role
 * client and cross-references auth.users via the Admin API for email.
 *
 * Caps at 1000 accounts (Admin API's max perPage) — fine for now; swap in
 * pagination once the user base actually approaches that.
 */
export async function getAllUsers(): Promise<UserManagementRow[]> {
  try {
    const supabase = createSupabaseServiceRoleClient();

    const [{ data: profiles, error: profilesError }, authUsersResult] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.auth.admin.listUsers({ perPage: 1000 }),
    ]);

    if (profilesError) {
      console.error("[getAllUsers] Failed to load profiles:", profilesError.message);
      return [];
    }
    if (authUsersResult.error) {
      console.error("[getAllUsers] Failed to load auth users:", authUsersResult.error.message);
    }

    const emailById = new Map((authUsersResult.data?.users ?? []).map((u) => [u.id, u.email ?? null]));
    return (profiles ?? []).map((profile) => ({
      ...profile,
      email: emailById.get(profile.id) ?? null,
    }));
  } catch (err) {
    console.error("[getAllUsers] Unexpected failure:", err);
    return [];
  }
}

/** Every category, active or not — Landing Content > Categories admin list. */
export async function getAllCategoriesForAdmin(): Promise<CategoryRow[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
    if (error) {
      console.error("[getAllCategoriesForAdmin] Supabase query failed:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("[getAllCategoriesForAdmin] Unexpected failure:", err);
    return [];
  }
}

/** Both service cards (Delivery + Marketplace), active or not — Landing Content > Service Cards. */
export async function getAllServiceOptionsForAdmin(): Promise<ServiceOptionRow[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.from("service_options").select("*").order("sort_order", { ascending: true });
    if (error) {
      console.error("[getAllServiceOptionsForAdmin] Supabase query failed:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("[getAllServiceOptionsForAdmin] Unexpected failure:", err);
    return [];
  }
}

/**
 * Every Marketplace order platform-wide, newest first, with its store's
 * name attached — Orders Oversight (read-only). The orders_admin_select
 * policy (0007) is what makes this legal for a role='admin' session.
 */
export async function getAllMarketplaceOrders(): Promise<MarketplaceOrderOverviewItem[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[getAllMarketplaceOrders] Supabase query failed:", error.message);
      return [];
    }
    if (!orders || orders.length === 0) return [];

    const storeIds = Array.from(new Set(orders.map((o) => o.store_id)));
    const { data: stores, error: storesError } = await supabase.from("stores").select("id, name").in("id", storeIds);
    if (storesError) {
      console.error("[getAllMarketplaceOrders] Failed to load store names:", storesError.message);
    }

    const storeNameById = new Map((stores ?? []).map((s) => [s.id, s.name]));
    return orders.map((order) => ({
      ...order,
      storeName: storeNameById.get(order.store_id) ?? null,
    }));
  } catch (err) {
    console.error("[getAllMarketplaceOrders] Unexpected failure:", err);
    return [];
  }
}
