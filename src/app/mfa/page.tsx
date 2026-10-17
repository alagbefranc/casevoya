import { Suspense } from "react";
import type { Metadata } from "next";
import { TwoStepMarkup, type TotpEnrollment } from "@/components/port/markup/two-step";
import { PortScreen } from "@/components/port/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Two-step sign-in · Casevoya",
  robots: { index: false, follow: false },
};

/** Code entry when a factor is already verified. Setup otherwise. Explicit recovery and step-up steps stay available. */
export function mfaActiveStep(hasVerifiedFactor: boolean, requested: number | null): number {
  if (!hasVerifiedFactor) return 2;
  if (requested === 1 || requested === 5 || requested === 6) return requested;
  return 0;
}

function qrSrc(qr: string) {
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
}

async function MfaReady({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
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
      } else {
        activeStep = mfaActiveStep(false, asked);
        for (const factor of factors?.all ?? []) {
          if (factor.factor_type === "totp" && factor.status !== "verified") {
            await supabase.auth.mfa.unenroll({ factorId: factor.id });
          }
        }
        const enrolled = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Casevoya",
          issuer: "Casevoya",
        });
        if (!enrolled.error && enrolled.data?.type === "totp") {
          enrollment = {
            factorId: enrolled.data.id,
            secret: enrolled.data.totp.secret,
            qr: qrSrc(enrolled.data.totp.qr_code),
          };
        }
      }
    }
  }

  return (
    <PortScreen page="mfa" variant="au" initialStep={activeStep}>
      <TwoStepMarkup email={email} activeStep={activeStep} enrollment={enrollment} />
    </PortScreen>
  );
}

export default function MfaPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
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
