import type { Metadata } from "next";
import { AcceptFamilyMarkup } from "@/components/port/markup/accept-family";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Olena’s invitation · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

export default function AcceptFamilyPage() {
  return (
    <PortScreen page="accept-family" variant="wzb">
      <AcceptFamilyMarkup />
    </PortScreen>
  );
}
