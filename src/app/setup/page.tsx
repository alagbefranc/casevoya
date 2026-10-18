import { Suspense } from "react";
import type { Metadata } from "next";
import type { FirmLogo } from "@/components/port/firm-logo-upload";
import { SetupMarkup } from "@/components/port/markup/setup";
import { PortScreen } from "@/components/port/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  FIRM_LOGO_BUCKET,
  FIRM_LOGO_PREVIEW_SECONDS,
  brandingAccent,
  brandingLogoLocator,
  ownFirmLogoKey,
} from "@/modules/firm-onboarding/firm-logo";

export const metadata: Metadata = {
  title: "Set up your firm · Casevoya",
  robots: { index: false, follow: false },
};

function SetupScreen({
  codes,
  firmName,
  logo,
  accent,
}: {
  codes: string[];
  firmName: string;
  logo: FirmLogo | null;
  accent: string | null;
}) {
  return (
    <PortScreen page="setup" variant="wzb">
      <SetupMarkup jurisdictionCodes={codes} firmName={firmName} logo={logo} accent={accent} />
    </PortScreen>
  );
}

/** A short-lived link to the firm's own saved logo in the private bucket. */
async function savedLogo(branding: unknown, organizationId: string): Promise<FirmLogo | null> {
  const locator = brandingLogoLocator(branding);
  const key = locator ? ownFirmLogoKey(locator, organizationId) : null;
  if (!locator || !key) return null;
  try {
    const { data } = await createServiceClient().storage.from(FIRM_LOGO_BUCKET).createSignedUrl(key, FIRM_LOGO_PREVIEW_SECONDS);
    return data?.signedUrl ? { locator, previewUrl: data.signedUrl } : null;
  } catch {
    return null;
  }
}

async function SavedSetup() {
  let codes = ["CA", "ON"];
  let firmName = "";
  let logo: FirmLogo | null = null;
  let accent: string | null = null;
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
          .select("jurisdiction_codes, display_name, branding")
          .eq("id", membership.organization_id)
          .maybeSingle();
        if (org?.jurisdiction_codes?.length) codes = [...org.jurisdiction_codes];
        if (org?.display_name) firmName = org.display_name;
        if (org) logo = await savedLogo(org.branding, membership.organization_id);
        // Saving Branding sends the colour shown, so the saved one must be shown, not reset.
        if (org) accent = brandingAccent(org.branding);
      }
    }
  }
  return <SetupScreen codes={codes} firmName={firmName} logo={logo} accent={accent} />;
}

export default function SetupPage() {
  return (
    <Suspense fallback={<SetupScreen codes={["CA", "ON"]} firmName="" logo={null} accent={null} />}>
      <SavedSetup />
    </Suspense>
  );
}
