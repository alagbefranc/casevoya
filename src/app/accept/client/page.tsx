import type { Metadata } from "next";
import { AcceptClientMarkup } from "@/components/port/markup/accept-client";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Your Northline portal · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

export default function AcceptClientPage() {
  return (
    <PortScreen page="accept-client" variant="wzb">
      <AcceptClientMarkup />
    </PortScreen>
  );
}
