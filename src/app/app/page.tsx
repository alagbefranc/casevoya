import { Suspense } from "react";
import { redirect } from "next/navigation";
import { homeRoute } from "@/lib/auth/home-route";
import { defaultLanding } from "@/lib/auth/landing";
import { loadSheetAccess } from "@/modules/sheet/load";

async function Route() {
  const home = await homeRoute();
  // A firm still in sample mode lands on Finish setup (decision 2026-10-19).
  const sampleMode = home === "/sheet" && (await loadSheetAccess()).kind === "sample";
  redirect(defaultLanding(home, sampleMode));
  return null;
}

/** The default after sign-in. Sends each person to their own workspace; never a dead end. */
export default function AppHome() {
  return (
    <Suspense fallback={null}>
      <Route />
    </Suspense>
  );
}
