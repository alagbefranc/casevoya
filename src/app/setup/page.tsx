import type { Metadata } from "next";
import { SetupMarkup } from "@/components/port/markup/setup";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Set up your firm · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

export default function SetupPage() {
  return (
    <PortScreen page="setup" variant="wzb">
      <SetupMarkup />
    </PortScreen>
  );
}
