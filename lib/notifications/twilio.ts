/**
 * Thin wrapper around Twilio's REST API using plain `fetch` — no `twilio`
 * npm package. This sandbox's npm registry access is blocked, and there's
 * no reason to add a dependency for two HTTP calls anyway: Twilio's
 * Messages resource is a single POST with Basic Auth.
 *
 * Covers both SMS and WhatsApp — same endpoint, same auth, the only
 * difference is the `whatsapp:` prefix on the From/To numbers.
 *
 * Required env vars (see .env.local.example):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_SMS_FROM        — a Twilio phone number, e.g. "+15017122661"
 *   TWILIO_WHATSAPP_FROM   — a Twilio WhatsApp sender, e.g.
 *                            "whatsapp:+14155238886" (the shared Sandbox
 *                            number until a real WhatsApp sender is approved)
 */

export interface SendResult {
  ok: boolean;
  error?: string;
}

// Every notification call happens synchronously inside a Server Action the
// sender is waiting on (see lib/actions/delivery.ts#createDeliveryOrder) —
// a hung Twilio/SendGrid request must never hang the user's "order placed"
// response, so every outbound fetch is time-boxed.
const REQUEST_TIMEOUT_MS = 8000;

function twilioCredentials(): { accountSid: string; authToken: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

async function postToTwilio(body: Record<string, string>): Promise<SendResult> {
  const creds = twilioCredentials();
  if (!creds) {
    return { ok: false, error: "Twilio isn't configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing)." };
  }

  try {
    const basicAuth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[twilio] Send failed:", response.status, detail);
      return { ok: false, error: `Twilio responded with ${response.status}.` };
    }
    return { ok: true };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("[twilio] Unexpected failure:", err);
    return { ok: false, error: timedOut ? "Timed out reaching Twilio." : "Couldn't reach Twilio." };
  }
}

/** Plain SMS via Twilio Programmable Messaging. `to` is a raw E.164 number, e.g. "+231770000000". */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const from = process.env.TWILIO_SMS_FROM;
  if (!from) return { ok: false, error: "TWILIO_SMS_FROM isn't set." };
  return postToTwilio({ To: to, From: from, Body: body });
}

/** WhatsApp message via Twilio. `to` is a raw E.164 number — the "whatsapp:" prefix is added here. */
export async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) return { ok: false, error: "TWILIO_WHATSAPP_FROM isn't set." };
  const toAddress = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  return postToTwilio({ To: toAddress, From: from, Body: body });
}
