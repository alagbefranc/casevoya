import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StartTrialMarkup } from "@/components/port/markup/start-trial";
import { PortScreen } from "@/components/port/screen";
import { homeRoute } from "@/lib/auth/home-route";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { readPublicPricing } from "@/modules/subscription/pricing";
import { pendingVerifyEmail } from "@/lib/auth/pending-verify";

export const metadata: Metadata = {
  title: "Start a trial · Casevoya",
  robots: { index: false, follow: false },
};

/**
 * No Suspense fallback here (#330): a fallback form swapped for the streamed one replaced the
 * inputs and wiped whatever autofill or a password manager had already typed.
 */
export default async function StartTrialPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const home = hasPublicSupabaseEnv() ? await homeRoute() : "/sign-in";
  if (home === "/sheet" || home === "/portal") redirect(home);
  // Signed in with no firm yet (an interrupted sign-up): ask only for the firm.
  let resume: { email: string } | undefined;
  if (home === "/start-trial") {
    const { data } = await (await createClient()).auth.getClaims();
    resume = { email: typeof data?.claims?.email === "string" ? data.claims.email : "your account" };
  }
  const verify = resume ? null : pendingVerifyEmail(query.verify);
  // The trial length from the admin setting trial.duration; no number when it cannot be read.
  let trialDays: number | null = null;
  if (hasPublicSupabaseEnv()) {
    const { data, error } = await (await createClient()).rpc("public_pricing");
    if (!error && data) trialDays = readPublicPricing(data).trialDays;
  }
  return (
    <PortScreen page="start-trial" variant="au" initialStep={resume ? 0 : verify ? 1 : undefined}>
      <StartTrialMarkup resume={resume} trialDays={trialDays} verifyEmail={verify} />
    </PortScreen>
  );
}
