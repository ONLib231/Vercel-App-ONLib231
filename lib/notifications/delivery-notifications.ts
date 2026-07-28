import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { sendSms, sendWhatsApp, type SendResult } from "@/lib/notifications/twilio";
import { sendEmail } from "@/lib/notifications/email";
import { orderCodeFor } from "@/lib/delivery";
import type { DeliverySettingsRow } from "@/types/delivery";

export interface NewDeliveryOrderNotificationInput {
  orderId: string;
  senderName: string;
  pickupAddress: string;
  dropoffAddress: string;
  itemDescription: string;
}

function toSendResult(err: unknown): SendResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/**
 * Fires the moment a sender places a new order (see
 * lib/actions/delivery.ts#createDeliveryOrder) — the one event wired up so
 * far per the "Order placed → notify admin" scope. The helpers this calls
 * (sendSms/sendWhatsApp/sendEmail) are generic, so wiring up the other
 * lifecycle events (accepted, picked up, delivered, cancelled) later is
 * just another call to this same pattern, not new plumbing.
 *
 * Sends to:
 *   - SMS + WhatsApp + Email -> the business contact info configured on the
 *     Delivery admin Settings page (delivery_settings.business_phone /
 *     business_email) — i.e. wherever the admin told the app to reach them.
 *   - In-app notification row -> every profile with role = 'admin', so the
 *     bell icon lights up for anyone with an admin login, not just whoever
 *     owns the configured business phone/email.
 *
 * Every channel is best-effort AND time-boxed: sendSms/sendWhatsApp/sendEmail
 * each carry their own fetch timeout (see lib/notifications/twilio.ts and
 * email.ts), and all four channels run concurrently rather than one after
 * another, so a slow/hung provider can only ever cost the single slowest
 * channel's timeout — never their sum, and never indefinitely. Every
 * failure is logged and swallowed, never thrown: placing the order must
 * never fail because a notification couldn't go out.
 */
export async function notifyAdminNewOrder(input: NewDeliveryOrderNotificationInput): Promise<void> {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const orderCode = orderCodeFor(input.orderId);

    const [settingsResult, adminsResult] = await Promise.all([
      supabase.from("delivery_settings").select("business_phone, business_email").eq("id", "business").maybeSingle(),
      supabase.from("profiles").select("id").eq("role", "admin"),
    ]);

    if (settingsResult.error) {
      console.error("[notifyAdminNewOrder] Failed to load delivery_settings:", settingsResult.error.message);
    }
    if (adminsResult.error) {
      console.error("[notifyAdminNewOrder] Failed to load admin profiles:", adminsResult.error.message);
    }

    // Cast explicitly — .maybeSingle() on a narrow (non-"*") select has been
    // unreliable in this project's pinned @supabase/postgrest-js version,
    // silently resolving to `never` instead of the selected columns' real
    // type (same issue fixed in lib/vendor.ts's getMyStore()).
    const settings = settingsResult.data as Pick<DeliverySettingsRow, "business_phone" | "business_email"> | null;
    const admins = adminsResult.data;

    const messageBody =
      `New delivery order ${orderCode} from ${input.senderName}: ` +
      `${input.pickupAddress} -> ${input.dropoffAddress} (${input.itemDescription}). Open the Orders board to accept it.`;

    const [smsResult, whatsAppResult, emailResult, notifyInsert] = await Promise.all([
      settings?.business_phone
        ? sendSms(settings.business_phone, messageBody).catch(toSendResult)
        : Promise.resolve<SendResult>({ ok: false, error: "No business_phone configured in Delivery Settings." }),
      settings?.business_phone
        ? sendWhatsApp(settings.business_phone, messageBody).catch(toSendResult)
        : Promise.resolve<SendResult>({ ok: false, error: "No business_phone configured in Delivery Settings." }),
      settings?.business_email
        ? sendEmail(
            settings.business_email,
            `New delivery order ${orderCode}`,
            `<p>${messageBody.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`
          ).catch(toSendResult)
        : Promise.resolve<SendResult>({ ok: false, error: "No business_email configured in Delivery Settings." }),
      admins && admins.length > 0
        ? supabase.from("notifications").insert(
            admins.map((admin) => ({
              user_id: admin.id,
              title: "New delivery order",
              body: messageBody,
            }))
          )
        : Promise.resolve(null),
    ]);

    if (!smsResult.ok) console.error("[notifyAdminNewOrder] SMS channel failed:", smsResult.error);
    if (!whatsAppResult.ok) console.error("[notifyAdminNewOrder] WhatsApp channel failed:", whatsAppResult.error);
    if (!emailResult.ok) console.error("[notifyAdminNewOrder] Email channel failed:", emailResult.error);
    if (notifyInsert?.error) {
      console.error("[notifyAdminNewOrder] In-app notification insert failed:", notifyInsert.error.message);
    }
  } catch (err) {
    // Never let a notification failure block order placement.
    console.error("[notifyAdminNewOrder] Unexpected failure:", err);
  }
}
