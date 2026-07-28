/**
 * Thin wrapper around Twilio SendGrid's REST API (v3 /mail/send) using plain
 * `fetch` — same reasoning as lib/notifications/twilio.ts, no SDK needed for
 * a single POST call. SendGrid is Twilio's email product but uses its own
 * API key (starts with "SG."), not the Twilio Account SID/Auth Token.
 *
 * Required env vars (see .env.local.example):
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL — a verified sender identity in your SendGrid account
 */

export interface SendResult {
  ok: boolean;
  error?: string;
}

// Same reasoning as lib/notifications/twilio.ts's REQUEST_TIMEOUT_MS — this
// runs synchronously inside a Server Action the sender is waiting on, so a
// hung SendGrid request must never hang their "order placed" response.
const REQUEST_TIMEOUT_MS = 8000;

export async function sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    return { ok: false, error: "SendGrid isn't configured (SENDGRID_API_KEY / SENDGRID_FROM_EMAIL missing)." };
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: "Verta Delivery" },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[sendgrid] Send failed:", response.status, detail);
      return { ok: false, error: `SendGrid responded with ${response.status}.` };
    }
    return { ok: true };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("[sendgrid] Unexpected failure:", err);
    return { ok: false, error: timedOut ? "Timed out reaching SendGrid." : "Couldn't reach SendGrid." };
  }
}
