import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Verta Platform",
  description: "ONLib Marketplace and Verta Delivery, one account.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
