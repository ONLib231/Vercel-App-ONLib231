// lib/notifications/send-delivery-notification.ts
//
// Fires SMS + WhatsApp + email + in-app notifications for a newly-placed
// delivery order, all four concurrently and each individually time-boxed,
// so one slow/misconfigured provider can never block the others and no
// channel failure can block (or roll back) the order that already succeeded
// in the database before this function is called.
import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendSms, sendWhatsApp } from "./twilio";
import { sendEmail } from "./sendgrid";
import { withTimeout } from "./with-timeout";
import type { Tables } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const CHANNEL_TIMEOUT_MS = 8000;

export type NotifyChannel = "sms" | "whatsapp" | "email" | "in_app";
export type NotifyChannelResult = { channel: NotifyChannel; ok: boolean; error?: string };

export async function notifyNewDeliveryOrder(order: Tables<"delivery_orders">): Promise<NotifyChannelResult[]> {
  const supabase = createServiceRoleClient();

  const { data: settings }: { data: Tables<"delivery_settings"> | null } = await supabase
    .from("delivery_settings")
    .select("*")
    .eq("id", "business")
    .maybeSingle();

  const summary = [
    `New delivery order from ${order.sender_name}.`,
    `Pickup: ${order.pickup_address}`,
    `Dropoff: ${order.dropoff_address}`,
    `Item: ${order.item_description}`,
  ].join("\n");

  const tasks: Promise<NotifyChannelResult>[] = [
    settings?.business_phone
      ? runChannel("sms", withTimeout(sendSms(settings.business_phone, summary), CHANNEL_TIMEOUT_MS, "sms"))
      : Promise.resolve<NotifyChannelResult>({ channel: "sms", ok: false, error: "no business_phone configured" }),

    settings?.business_phone
      ? runChannel("whatsapp", withTimeout(sendWhatsApp(settings.business_phone, summary), CHANNEL_TIMEOUT_MS, "whatsapp"))
      : Promise.resolve<NotifyChannelResult>({ channel: "whatsapp", ok: false, error: "no business_phone configured" }),

    settings?.business_email
      ? runChannel(
          "email",
          withTimeout(sendEmail(settings.business_email, "New Verta delivery order", summary), CHANNEL_TIMEOUT_MS, "email")
        )
      : Promise.resolve<NotifyChannelResult>({ channel: "email", ok: false, error: "no business_email configured" }),

    runChannel("in_app", withTimeout(notifyAdminsInApp(supabase, order), CHANNEL_TIMEOUT_MS, "in_app")),
  ];

  // allSettled (not all/race): every channel gets to finish or time out on
  // its own, and a rejection from one never short-circuits the others.
  const settledResults = await Promise.allSettled(tasks);
  const channelOrder: NotifyChannel[] = ["sms", "whatsapp", "email", "in_app"];

  return settledResults.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : { channel: channelOrder[index] ?? "in_app", ok: false, error: describeError(result.reason) }
  );
}

async function runChannel(channel: NotifyChannel, work: Promise<void>): Promise<NotifyChannelResult> {
  try {
    await work;
    return { channel, ok: true };
  } catch (error) {
    return { channel, ok: false, error: describeError(error) };
  }
}

async function notifyAdminsInApp(supabase: SupabaseClient<Database>, order: Tables<"delivery_orders">): Promise<void> {
  const { data: admins, error: adminsError }: { data: { id: string }[] | null; error: { message: string } | null } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin");

  if (adminsError) throw new Error(adminsError.message);
  if (!admins || admins.length === 0) return;

  const rows = admins.map((admin) => ({
    user_id: admin.id,
    title: "New delivery order",
    body: `${order.sender_name} requested a pickup at ${order.pickup_address}.`,
  }));

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) throw new Error(error.message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
