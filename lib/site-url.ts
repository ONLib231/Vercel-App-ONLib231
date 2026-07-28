// lib/site-url.ts
// Resolves the absolute site URL for building OAuth/email redirect links.
// Prefers NEXT_PUBLIC_SITE_URL when set (recommended for production, so
// redirects are deterministic regardless of which edge/host served the
// request). Falls back to the current request's Host header — this matters
// for Vercel preview deployments, where every PR gets its own generated
// domain and a hardcoded URL would silently redirect to the wrong preview.
import { headers } from "next/headers";

export async function getSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  try {
    const headerList = await headers();
    const forwardedHost = headerList.get("x-forwarded-host");
    const host = forwardedHost ?? headerList.get("host");
    if (host) {
      const forwardedProto = headerList.get("x-forwarded-proto");
      const proto = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // headers() throws when called outside a request scope, e.g. from a
    // background job or a script. Fall through to the localhost default.
  }

  return "http://localhost:3000";
}
