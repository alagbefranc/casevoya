import { Suspense } from "react";
import { redirect } from "next/navigation";
import { homeRoute } from "@/lib/auth/home-route";
import { safeNext } from "@/lib/auth/redirect";
import type { Metadata } from "next";
import { TwoStepMarkup, type TotpEnrollment } from "@/components/port/markup/two-step";
import { PortScreen } from "@/components/port/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { readPendingTotp, withQr } from "@/lib/auth/mfa-pending";
import { createClient } from "@/lib/supabase/server";
import { mfaActiveStep, mfaDoneLabel, stepUpAction, stepUpLead } from "@/lib/auth/mfa-step";

export const metadata: Metadata = {
  title: "Two-step sign-in · Casevoya",
  robots: { index: false, follow: false },
};

async function MfaReady({ searchParams }: { searchParams: Promise<{ step?: string; next?: string; for?: string }> }) {
  const params = await searchParams;
  const requested = Number(params.step);
  const asked = Number.isFinite(requested) ? requested : null;
  let email: string | null = null;
  let activeStep = 0;
  let enrollment: TotpEnrollment | null = null;

  if (hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claim = data?.claims?.email;
    if (typeof claim === "string") email = claim;
    if (data?.claims?.sub) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.all?.find((factor) => factor.factor_type === "totp" && factor.status === "verified");
      if (verified) {
        activeStep = mfaActiveStep(true, asked);
      } else if (asked === null && (await homeRoute()) === "/portal") {
        // A client, sponsor or family member has no two-step to set up: send them to their portal.
        const next = safeNext(params.next, "/portal");
        redirect(next.startsWith("/portal") ? next : "/portal");
      } else {
        activeStep = mfaActiveStep(false, asked);
        // Never enrol while rendering: a reload would replace a QR the person already scanned.
        // Setup starts from the client on the setup step; a pending one is shown again here.
        const pending = await readPendingTotp();
        const stillOpen = factors?.all?.some(
          (factor) => factor.id === pending?.factorId && factor.factor_type === "totp" && factor.status !== "verified",
        );
        if (pending && stillOpen) enrollment = await withQr(pending);
      }
    }
  }

  return (
    <PortScreen page="mfa" variant="au" initialStep={activeStep}>
      <TwoStepMarkup email={email} activeStep={activeStep} enrollment={enrollment} stepUpLead={stepUpLead(params.next, params.for)} stepUpAction={stepUpAction(params.next, params.for)} doneLabel={mfaDoneLabel(params.next)} />
    </PortScreen>
  );
}

export default function MfaPage({ searchParams }: { searchParams: Promise<{ step?: string; next?: string; for?: string }> }) {
  return (
    <Suspense
      fallback={
        <PortScreen page="mfa" variant="au" initialStep={0}>
          <TwoStepMarkup activeStep={0} />
        </PortScreen>
      }
    >
      <MfaReady searchParams={searchParams} />
    </Suspense>
  );
}
