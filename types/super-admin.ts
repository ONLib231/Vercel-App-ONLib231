/**
 * View models for the Super Admin dashboard (app/admin/*). Built on top of
 * tables that already exist elsewhere in the codebase — see
 * supabase/migrations/0007_super_admin_module.sql for the RLS additions
 * this dashboard needed (vendor_applications admin read/update, orders
 * admin read).
 */

import type { OrderRow, ProfileRow, VendorApplicationRow } from "@/types/vendor";
import type { AccentTheme, BadgeIcon } from "@/types/service";

export interface PlatformStats {
  pendingVendorApplications: number;
  approvedVendors: number;
  totalUsers: number;
  totalStores: number;
  totalMarketplaceOrders: number;
  totalDeliveryOrders: number;
}

/** A vendor_applications row joined with the applicant's profile — admin review list. */
export interface VendorApplicationReviewItem extends VendorApplicationRow {
  applicantName: string | null;
  applicantPhone: string | null;
  /** Short-lived (10 min) signed Storage URLs — see lib/super-admin.ts#getVendorApplications. */
  businessRegistrationUrl: string | null;
  idDocumentUrl: string | null;
}

/** A profiles row plus its auth email (profiles itself has no email column — see lib/super-admin.ts). */
export interface UserManagementRow extends ProfileRow {
  email: string | null;
}

export interface CategoryFormInput {
  id?: string;
  name: string;
  slug: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ServiceOptionFormInput {
  id: string;
  title: string;
  subtitle: string;
  badgeLabel: string;
  badgeIcon: BadgeIcon;
  accent: AccentTheme;
  route: string;
  sortOrder: number;
  isActive: boolean;
}

/** Marketplace order joined with its store's name — for the platform-wide orders overview. */
export interface MarketplaceOrderOverviewItem extends OrderRow {
  storeName: string | null;
}
