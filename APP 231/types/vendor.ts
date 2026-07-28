/**
 * Mirrors the tables created in
 * supabase/migrations/0004_create_vendor_module.sql
 */

export type VendorApplicationStatus = "pending" | "approved" | "rejected";
export type IdDocumentType = "passport" | "national_id" | "drivers_license";

export interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: "customer" | "vendor" | "driver" | "admin";
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorApplicationRow {
  id: string;
  user_id: string;
  business_name: string;
  id_document_type: IdDocumentType;
  business_registration_path: string;
  id_document_path: string;
  status: VendorApplicationStatus;
  reviewer_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  /** profiles.id of the Super Admin who approved/rejected this — added in 0007_super_admin_module.sql. */
  reviewed_by: string | null;
}

export interface OrderRow {
  id: string;
  store_id: string;
  buyer_id: string | null;
  buyer_name: string;
  status: "processing" | "fulfilled" | "cancelled";
  total_cents: number;
  currency: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// View models consumed by components
// ---------------------------------------------------------------------------

export interface OrderViewModel {
  id: string;
  orderNumber: string; // "#12304" — derived from OrderRow.id for display
  buyerName: string;
  status: OrderRow["status"];
  statusLabel: string;
  totalLabel: string;
}

export interface VendorDashboardStats {
  salesLast30Label: string;
  salesChangePct: number;
  /** Normalized 0–100 points for the inline sparkline/area chart. */
  salesTrend: number[];
  totalOrders: number;
  newLeads: number;
  recentOrders: OrderViewModel[];
}

export interface VendorNavUser {
  name: string;
  /** Store-management role label shown in the Vendor Dashboard header
   *  ("Girlee Fashion / Admin" in the mockup) — distinct from the platform
   *  `profiles.role` enum; every approved vendor manages their own store as
   *  its "Admin". */
  role: "Admin";
  avatarUrl: string | null;
}
