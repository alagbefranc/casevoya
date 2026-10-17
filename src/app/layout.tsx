import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Casevoya",
  description: "Practice management for licensed Canadian immigration consultancies.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-CA" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-canvas text-ink">{children}</body>
    </html>
  );
}
