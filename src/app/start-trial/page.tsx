import type { Metadata } from "next";
import { StartTrialMarkup } from "@/components/port/markup/start-trial";
import { PortScreen } from "@/components/port/screen";

export const metadata: Metadata = {
  title: "Start a trial · Casevoya",
  robots: { index: false, follow: false },
};

export default function StartTrialPage() {
  return (
    <PortScreen page="start-trial" variant="au">
      <StartTrialMarkup />
    </PortScreen>
  );
}
