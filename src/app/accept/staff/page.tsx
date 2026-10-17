import type { Metadata } from "next";
import { AcceptStaffMarkup } from "@/components/port/markup/accept-staff";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Join Northline Immigration · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

export default function AcceptStaffPage() {
  return (
    <PortScreen page="accept-staff" variant="au">
      <AcceptStaffMarkup />
    </PortScreen>
  );
}
