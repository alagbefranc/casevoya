import type { Metadata } from "next";
import { TwoStepMarkup } from "@/components/port/markup/two-step";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Two-step sign-in · Casevoya (prototype)",
  robots: { index: false, follow: false },
};

export default function MfaPage() {
  return (
    <PortScreen page="mfa" variant="au">
      <TwoStepMarkup />
    </PortScreen>
  );
}
