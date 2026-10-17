import type { Metadata, Viewport } from "next";
import { erode } from "@/fonts/erode";
import { inter } from "@/fonts/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Casevoya",
  description: "Practice management for licensed Canadian immigration consultancies.",
  icons: {
    icon: [
      { url: "/assets/brand/favicon.ico", sizes: "32x32" },
      { url: "/assets/brand/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/assets/brand/apple-touch-icon.png",
  },
  manifest: "/assets/brand/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0075DE",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-CA" className={`${erode.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-canvas text-ink">{children}</body>
    </html>
  );
}
