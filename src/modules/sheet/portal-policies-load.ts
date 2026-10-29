import "server-only";
import type { PolicyDialogData, PortalPoliciesData } from "@/components/sheet/designer/portal-policies";
import { createClient } from "@/lib/supabase/server";
import { privacyPath } from "@/modules/leads/privacy";
import { loadCurrentPolicies, loadPublicPagesState } from "@/modules/portal-policies/load";
import { canPublishPolicies, POLICY_KINDS } from "@/modules/portal-policies/defaults";
import { publicPagesWarning } from "@/modules/portal-policies/public-pages";
import { policyCards, policyDialog } from "@/modules/portal-policies/present";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";

/**
 * Settings > Client portal for a firm: its current terms and privacy notice, and the publish
 * dialogs prefilled with the published text, or the starting drafts with the firm's own name
 * and privacy contact. Read as the signed-in staff member so the database decides. #263-A: the
 * privacy notice's public page, the owner's Unpublish, and the banner when the firm's booking or
 * enquiry pages are on without a published notice.
 */
export async function loadSheetPortalPolicies(staff: SheetStaff) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, current, firm] = await Promise.all([
    loadSheetChrome(staff, "/sheet/settings"),
    loadCurrentPolicies(supabase, org),
    supabase.from("organizations").select("display_name, slug, privacy_contact_name, privacy_contact_email").eq("id", org).maybeSingle(),
  ]);
  const publicPages = publicPagesWarning(await loadPublicPagesState(supabase, org, current), Date.now(), staff.timezone);
  const facts = {
    firmName: firm.data?.display_name || staff.organizationName,
    privacyContactName: firm.data?.privacy_contact_name ?? null,
    privacyContactEmail: firm.data?.privacy_contact_email ?? null,
  };
  const canPublish = canPublishPolicies(staff.role);
  const canUnpublish = staff.role === "firm_owner";
  const page: PortalPoliciesData = {
    firmName: staff.organizationName,
    cards: policyCards(current, staff.timezone),
    canPublish,
    contactMissing: !facts.privacyContactName || !facts.privacyContactEmail,
    publicHref: firm.data?.slug ? privacyPath(firm.data.slug) : null,
    canUnpublish,
    publicPages,
  };
  const dialogs: PolicyDialogData[] = canPublish ? POLICY_KINDS.map((kind) => policyDialog(kind, current[kind], facts, org)) : [];
  const unpublishOrg = canUnpublish && current.privacy_notice ? org : null;
  return { chrome, page, dialogs, unpublishOrg };
}
