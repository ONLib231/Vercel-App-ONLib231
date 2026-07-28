import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Everything else in /marketplace/* is public browsing (home, categories,
 * stores, product/store detail, search, deals) — guests can look around
 * freely. These prefixes are where "shopping" actually happens (cart,
 * checkout, orders) or where the page is inherently account-scoped
 * (wishlist, addresses, payment methods, messages, settings, account,
 * notifications); a signed-out visitor gets bounced to /login?next=<page>
 * instead of an empty/broken account page.
 */
const PROTECTED_PREFIXES = [
  "/marketplace/cart",
  "/marketplace/checkout",
  "/marketplace/wishlist",
  "/marketplace/orders",
  "/marketplace/account",
  "/marketplace/messages",
  "/marketplace/addresses",
  "/marketplace/payment-methods",
  "/marketplace/settings",
  "/marketplace/notifications",
  // The Vendor Dashboard is entirely account-scoped — unlike /marketplace,
  // there's no public-browsing part of it, so the whole /vendor tree
  // requires auth. Role (vendor vs customer) and approval status are
  // checked separately in app/vendor/layout.tsx, since that needs a
  // profiles/vendor_applications lookup this Edge middleware avoids.
  "/vendor",
  // Same reasoning for Delivery — placing/tracking an order is inherently
  // tied to an account (RLS keys every row off sender_id), so there's no
  // anonymous-browsing part of /delivery either. The admin-only /delivery/admin
  // sub-tree is gated separately in app/delivery/admin/layout.tsx.
  "/delivery",
  // The Super Admin dashboard — role check (profiles.role === 'admin') is
  // done in app/admin/layout.tsx, same reasoning as /vendor and /delivery/admin.
  "/admin",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (isProtectedPath(pathname) && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);

    const redirectResponse = NextResponse.redirect(loginUrl);
    // Carry over any session cookies updateSession() just refreshed so a
    // near-expiry token isn't dropped on the way to the login redirect.
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
