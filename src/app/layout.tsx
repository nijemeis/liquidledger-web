import type { Metadata, Viewport } from "next";
import { Geist, Oleo_Script } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/i18n/server";

const geist = Geist({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700"], variable: "--font-geist", display: "swap" });
const oleo = Oleo_Script({ subsets: ["latin", "latin-ext"], weight: ["400"], variable: "--font-oleo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Liquid Ledger", template: "%s · Liquid Ledger" },
  description: "Bookkeeping, stock and excise for importers, exporters and wholesalers of drinks.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#7a1f3d" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${geist.variable} ${oleo.variable}`}>
      <body>{children}</body>
    </html>
  );
}
