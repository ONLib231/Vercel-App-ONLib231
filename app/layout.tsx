import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ONLib — Shop & Delivery, One Account",
  description:
    "Send packages on demand with Verta Delivery, or shop trusted vendors on ONLib Marketplace — one account, two powerful experiences.",
};

// Mobile-first viewport tuned for a future Capacitor.js wrap (no zoom jank on tap).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f4f6fb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
