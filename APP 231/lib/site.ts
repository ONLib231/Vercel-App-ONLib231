import { headers } from "next/headers";

/**
 * Best-effort absolute origin for building OAuth/email redirect URLs from a
 * Server Action (no direct access to `window.location` there). Prefers an
 * explicit env var — set NEXT_PUBLIC_SITE_URL in production so redirects
 * are correct behind a reverse proxy — falling back to the request's own
 * Host header for local dev / previews.
 */
export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  const headerList = headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
