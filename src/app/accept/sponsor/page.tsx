import type { Metadata } from "next";
import { AcceptSponsorMarkup } from "@/components/port/markup/accept-sponsor";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Rafael’s invitation · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

export default function AcceptSponsorPage() {
  return (
    <PortScreen page="accept-sponsor" variant="wzb">
      <AcceptSponsorMarkup />
    </PortScreen>
  );
}
