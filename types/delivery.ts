/**
 * Mirrors the tables created in
 * supabase/migrations/0006_create_delivery_module.sql
 *
 * This is the Next.js/Supabase port of the standalone Verta Delivery app
 * kept for reference under /verta-delivery in the workspace — see that
 * migration's header comment for the full mapping from the original data
 * model to this one.
 */

export type DeliveryOrderStatus = "pending" | "accepted" | "picked_up" | "delivered" | "cancelled";

export interface DeliveryOrderRow {
  id: string;
  sender_id: string;
  sender_name: string;
  pickup_address: string;
  dropoff_address: string;
  item_description: string;
  amount: number | null;
  status: DeliveryOrderStatus;
  accepted_by: string | null;
  payment_method: string | null;
  placed_by_admin: boolean;
  created_at: string;
  accepted_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
}

export type DeliveryAgentDutyStatus = "on_duty" | "off_duty";

export interface DeliveryAgentRow {
  id: string;
  name: string;
  phone: string;
  duty_status: DeliveryAgentDutyStatus;
  created_at: string;
}

export interface DeliveryExpenseRow {
  id: string;
  expense_date: string;
  amount: number;
  description: string;
  created_at: string;
}

export interface DeliveryPricePresetRow {
  id: string;
  label: string;
  amount: number;
  created_at: string;
}

export interface DeliverySettingsRow {
  id: string;
  business_name: string | null;
  business_email: string | null;
  business_phone: string | null;
  business_address: string | null;
  business_description: string | null;
  logo_path: string | null;
  opening_time: string | null;
  closing_time: string | null;
  open_days: string[] | null;
  currency: string;
  timezone: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// View models / action payloads
// ---------------------------------------------------------------------------

export interface DeliveryOrderViewModel {
  id: string;
  orderCode: string; // "#A1B2C3" — derived from DeliveryOrderRow.id for display
  senderName: string;
  pickupAddress: string;
  dropoffAddress: string;
  itemDescription: string;
  amountLabel: string | null;
  status: DeliveryOrderStatus;
  statusLabel: string;
  acceptedBy: string | null;
  paymentMethod: string | null;
  createdAtLabel: string;
}

export interface DeliveryDashboardStats {
  pendingCount: number;
  acceptedCount: number;
  deliveredTodayCount: number;
  revenueLast30Label: string;
}

export interface CreateDeliveryOrderInput {
  pickupAddress: string;
  dropoffAddress: string;
  itemDescription: string;
}

export interface AcceptDeliveryOrderInput {
  orderId: string;
  amount: number;
  acceptedBy: string;
  paymentMethod?: string;
}

export interface AdminUpdateDeliveryOrderInput {
  orderId: string;
  status?: DeliveryOrderStatus;
  amount?: number;
  acceptedBy?: string;
  paymentMethod?: string;
}
