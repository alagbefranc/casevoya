import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StartTrialMarkup } from "@/components/port/markup/start-trial";
import { PortScreen } from "@/components/port/screen";
import { homeRoute } from "@/lib/auth/home-route";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Start a trial · Casevoya",
  robots: { index: false, follow: false },
};

async function Trial() {
  const home = hasPublicSupabaseEnv() ? await homeRoute() : "/sign-in";
  if (home === "/sheet" || home === "/portal") redirect(home);
  // Signed in with no firm yet (an interrupted sign-up): ask only for the firm.
  let resume: { email: string } | undefined;
  if (home === "/start-trial") {
    const { data } = await (await createClient()).auth.getClaims();
    resume = { email: typeof data?.claims?.email === "string" ? data.claims.email : "your account" };
  }
  return (
    <PortScreen page="start-trial" variant="au" initialStep={resume ? 0 : undefined}>
      <StartTrialMarkup resume={resume} />
    </PortScreen>
  );
}

export default function StartTrialPage() {
  return (
    <Suspense
      fallback={
        <PortScreen page="start-trial" variant="au">
          <StartTrialMarkup />
        </PortScreen>
      }
    >
      <Trial />
    </Suspense>
  );
}
