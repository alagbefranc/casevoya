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
import { setupSaved, type SetupSaved } from "@/modules/firm-onboarding/setup-saved";
import { missingPolicies } from "@/modules/portal-policies/defaults";
import { loadCurrentPolicies } from "@/modules/portal-policies/load";

export const metadata: Metadata = {
  title: "Set up your firm · Casevoya",
  robots: { index: false, follow: false },
};

type SetupLicence = { number: string; className: "RCIC" | "RCIC-IRB" };

function SetupScreen({
  codes,
  firmName,
  logo,
  accent,
  licence = null,
  saved = null,
  policiesMissing = false,
}: {
  codes: string[];
  firmName: string;
  logo: FirmLogo | null;
  accent: string | null;
  licence?: SetupLicence | null;
  saved?: SetupSaved | null;
  policiesMissing?: boolean;
}) {
  return (
    <PortScreen page="setup" variant="wzb">
      <SetupMarkup jurisdictionCodes={codes} firmName={firmName} logo={logo} accent={accent} licence={licence} saved={saved} policiesMissing={policiesMissing} />
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
  let licence: SetupLicence | null = null;
  let saved: SetupSaved | null = null;
  let policiesMissing = false;
  if (hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (userId) {
      const { data: membership } = await supabase
        .from("memberships")
        .select("id, organization_id")
        .eq("user_id", userId)
        .eq("role", "firm_owner")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (membership) {
        const scoped = await createClient({ organizationId: membership.organization_id });
        const orgId = membership.organization_id;
        const [{ data: org }, { data: office }, { data: steps }, { data: profile }, policies] = await Promise.all([
          scoped
            .from("organizations")
            .select(
              "jurisdiction_codes, display_name, legal_name, branding, timezone, billing_contact_name, billing_contact_email, privacy_contact_name, privacy_contact_email, subscription_terms_accepted_at",
            )
            .eq("id", orgId)
            .maybeSingle(),
          scoped
            .from("organization_offices")
            .select("address_line, locality, region, postal_code")
            .eq("organization_id", orgId)
            .eq("is_primary", true)
            .maybeSingle(),
          scoped.from("organization_setup_steps").select("step").eq("organization_id", orgId),
          supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
          loadCurrentPolicies(scoped, orgId),
        ]);
        if (org?.jurisdiction_codes?.length) codes = [...org.jurisdiction_codes];
        if (org?.display_name) firmName = org.display_name;
        // Steps 1 and 2 come back as saved; the owner is the first answer for both contacts.
        const metaName = (claims?.claims?.user_metadata as { display_name?: unknown } | undefined)?.display_name;
        saved = setupSaved(
          org,
          office,
          {
            name: profile?.display_name || (typeof metaName === "string" ? metaName : null),
            email: typeof claims?.claims?.email === "string" ? claims.claims.email : null,
          },
          (steps ?? []).map((row) => row.step as string),
        );
        policiesMissing = missingPolicies(policies).length > 0;
        if (org) logo = await savedLogo(org.branding, membership.organization_id);
        // Saving Branding sends the colour shown, so the saved one must be shown, not reset.
        if (org) accent = brandingAccent(org.branding);
        // The licence declared at sign-up fills "Your licence".
        const { data: credential } = await scoped
          .from("consultant_credentials")
          .select("college_id, licence_type, scope_note")
          .eq("organization_id", membership.organization_id)
          .eq("membership_id", membership.id)
          .maybeSingle();
        if (credential?.licence_type === "RCIC") licence = { number: credential.college_id, className: credential.scope_note === "RCIC-IRB" ? "RCIC-IRB" : "RCIC" };
      }
    }
  }
  return <SetupScreen codes={codes} firmName={firmName} logo={logo} accent={accent} licence={licence} saved={saved} policiesMissing={policiesMissing} />;
}

export default function SetupPage() {
  return (
    <Suspense fallback={<SetupScreen codes={["CA", "ON"]} firmName="" logo={null} accent={null} />}>
      <SavedSetup />
    </Suspense>
  );
}
