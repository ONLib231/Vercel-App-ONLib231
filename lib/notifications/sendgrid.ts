// lib/notifications/sendgrid.ts
import "server-only";
import sgMail from "@sendgrid/mail";

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("SENDGRID_API_KEY is not configured.");
  sgMail.setApiKey(apiKey);
  configured = true;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  ensureConfigured();
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!from) throw new Error("SENDGRID_FROM_EMAIL is not configured (must be a verified sender in SendGrid).");

  await sgMail.send({ to, from, subject, text });
}
