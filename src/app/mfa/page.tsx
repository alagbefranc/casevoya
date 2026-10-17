import { Suspense } from "react";
import type { Metadata } from "next";
import { TwoStepMarkup } from "@/components/port/markup/two-step";
import { PortScreen } from "@/components/port/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Two-step sign-in · Casevoya",
  robots: { index: false, follow: false },
};

async function SignedInCode() {
  let email: string | null = null;
  if (hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claim = data?.claims?.email;
    if (typeof claim === "string") email = claim;
  }
  return <TwoStepMarkup email={email} />;
}

export default function MfaPage() {
  return (
    <PortScreen page="mfa" variant="au">
      <Suspense fallback={<TwoStepMarkup />}>
        <SignedInCode />
      </Suspense>
    </PortScreen>
  );
}
