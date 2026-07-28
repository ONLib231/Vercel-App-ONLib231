// lib/notifications/twilio.ts
import "server-only";
import twilio from "twilio";

let cachedClient: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (cachedClient) return cachedClient;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured.");
  }

  cachedClient = twilio(accountSid, authToken);
  return cachedClient;
}

export async function sendSms(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_SMS_FROM;
  if (!from) throw new Error("TWILIO_SMS_FROM is not configured.");
  await getClient().messages.create({ to, from, body });
}

export async function sendWhatsApp(to: string, body: string): Promise<void> {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new Error("TWILIO_WHATSAPP_FROM is not configured.");
  await getClient().messages.create({
    to: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
    from: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    body,
  });
}
