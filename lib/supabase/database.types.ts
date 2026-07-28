/**
 * Hand-authored slice of the generated Supabase `Database` type, scoped to
 * what this section needs. Once the full schema exists, replace this file
 * with the output of:
 *
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/database.types.ts
 */
import type { ServiceOptionRow } from "@/types/service";
import type {
  CartItemRow,
  CategoryRow,
  NotificationRow,
  ProductRow,
  StoreRow,
  WishlistItemRow,
} from "@/types/marketplace";
import type { OrderRow, ProfileRow, VendorApplicationRow } from "@/types/vendor";
import type {
  DeliveryAgentRow,
  DeliveryExpenseRow,
  DeliveryOrderRow,
  DeliveryPricePresetRow,
  DeliverySettingsRow,
} from "@/types/delivery";

export interface Database {
  public: {
    Tables: {
      service_options: {
        Row: ServiceOptionRow;
        Insert: Partial<ServiceOptionRow> &
          Pick<ServiceOptionRow, "key" | "title" | "subtitle" | "badge_label" | "image_path" | "route">;
        Update: Partial<ServiceOptionRow>;
      };
      categories: {
        Row: CategoryRow;
        Insert: Partial<CategoryRow> & Pick<CategoryRow, "name" | "slug">;
        Update: Partial<CategoryRow>;
      };
      stores: {
        Row: StoreRow;
        Insert: Partial<StoreRow> & Pick<StoreRow, "name" | "slug">;
        Update: Partial<StoreRow>;
      };
      products: {
        Row: ProductRow;
        Insert: Partial<ProductRow> & Pick<ProductRow, "store_id" | "name" | "slug" | "price_cents">;
        Update: Partial<ProductRow>;
      };
      cart_items: {
        Row: CartItemRow;
        Insert: Partial<CartItemRow> & Pick<CartItemRow, "user_id" | "product_id">;
        Update: Partial<CartItemRow>;
      };
      wishlist_items: {
        Row: WishlistItemRow;
        Insert: Partial<WishlistItemRow> & Pick<WishlistItemRow, "user_id" | "product_id">;
        Update: Partial<WishlistItemRow>;
      };
      notifications: {
        Row: NotificationRow;
        Insert: Partial<NotificationRow> & Pick<NotificationRow, "user_id" | "title">;
        Update: Partial<NotificationRow>;
      };
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & Pick<ProfileRow, "id">;
        Update: Partial<ProfileRow>;
      };
      vendor_applications: {
        Row: VendorApplicationRow;
        Insert: Partial<VendorApplicationRow> &
          Pick<
            VendorApplicationRow,
            "user_id" | "business_name" | "id_document_type" | "business_registration_path" | "id_document_path"
          >;
        Update: Partial<VendorApplicationRow>;
      };
      orders: {
        Row: OrderRow;
        Insert: Partial<OrderRow> & Pick<OrderRow, "store_id" | "buyer_name" | "total_cents">;
        Update: Partial<OrderRow>;
      };
      delivery_orders: {
        Row: DeliveryOrderRow;
        Insert: Partial<DeliveryOrderRow> &
          Pick<DeliveryOrderRow, "sender_id" | "sender_name" | "pickup_address" | "dropoff_address" | "item_description">;
        Update: Partial<DeliveryOrderRow>;
      };
      delivery_agents: {
        Row: DeliveryAgentRow;
        Insert: Partial<DeliveryAgentRow> & Pick<DeliveryAgentRow, "name" | "phone">;
        Update: Partial<DeliveryAgentRow>;
      };
      delivery_expenses: {
        Row: DeliveryExpenseRow;
        Insert: Partial<DeliveryExpenseRow> & Pick<DeliveryExpenseRow, "expense_date" | "amount" | "description">;
        Update: Partial<DeliveryExpenseRow>;
      };
      delivery_price_presets: {
        Row: DeliveryPricePresetRow;
        Insert: Partial<DeliveryPricePresetRow> & Pick<DeliveryPricePresetRow, "label" | "amount">;
        Update: Partial<DeliveryPricePresetRow>;
      };
      delivery_settings: {
        Row: DeliverySettingsRow;
        Insert: Partial<DeliverySettingsRow>;
        Update: Partial<DeliverySettingsRow>;
      };
    };
  };
}
