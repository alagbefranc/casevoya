import type { Metadata } from "next";
import { RecoveryMarkup } from "@/components/port/markup/recovery";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Account recovery · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

export default function RecoveryPage() {
  return (
    <PortScreen page="recovery" variant="au">
      <RecoveryMarkup />
    </PortScreen>
  );
}
