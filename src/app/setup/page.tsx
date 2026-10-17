import { Suspense } from "react";
import type { Metadata } from "next";
import { SetupMarkup } from "@/components/port/markup/setup";
import { PortScreen } from "@/components/port/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set up your firm · Casevoya",
  robots: { index: false, follow: false },
};

function SetupScreen({ codes, firmName }: { codes: string[]; firmName: string }) {
  return (
    <PortScreen page="setup" variant="wzb">
      <SetupMarkup jurisdictionCodes={codes} firmName={firmName} />
    </PortScreen>
  );
}

async function SavedSetup() {
  let codes = ["CA", "ON"];
  let firmName = "";
  if (hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (userId) {
      const { data: membership } = await supabase
        .from("memberships")
        .select("organization_id")
        .eq("user_id", userId)
        .eq("role", "firm_owner")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (membership) {
        const scoped = await createClient({ organizationId: membership.organization_id });
        const { data: org } = await scoped
          .from("organizations")
          .select("jurisdiction_codes, display_name")
          .eq("id", membership.organization_id)
          .maybeSingle();
        if (org?.jurisdiction_codes?.length) codes = [...org.jurisdiction_codes];
        if (org?.display_name) firmName = org.display_name;
      }
    }
  }
  return <SetupScreen codes={codes} firmName={firmName} />;
}

export default function SetupPage() {
  return (
    <Suspense fallback={<SetupScreen codes={["CA", "ON"]} firmName="" />}>
      <SavedSetup />
    </Suspense>
  );
}
