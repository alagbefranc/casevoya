import "server-only";
import type { LicenceDialogsData, LicencesData, LicenceTab } from "@/components/sheet/designer/licence";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  checkTargetLabel,
  licenceCards,
  licenceDialogs,
  licenceIntro,
  licenceLog,
  recheckMonths,
  type LicenceContext,
  type LicenceCredential,
  type LicenceLogRow,
  type LicenceMember,
} from "@/modules/sheet/licence-present";

type Client = Awaited<ReturnType<typeof createClient>>;

const CREDENTIAL_COLUMNS =
  "id, membership_id, licence_type, college_id, scope_note, status, verification_method, proof_locator, source_url, register_status, entitlement_to_practise, discipline_restricted, discipline_restriction_detail, declared_at, checked_at, next_review_at, valid_until";

/** Active and suspended staff with names, through public.firm_staff_directory. */
export async function loadLicenceMembers(supabase: Client, org: string): Promise<LicenceMember[]> {
  const directory = await supabase.rpc("firm_staff_directory", { p_organization_id: org });
  return (directory.data ?? []).map((row) => ({
    membershipId: row.membership_id,
    name: row.display_name,
    role: row.role,
    status: row.status,
    isSelf: row.is_self,
  }));
}

export async function loadLicenceCredentials(supabase: Client, org: string): Promise<LicenceCredential[]> {
  const { data } = await supabase.from("consultant_credentials").select(CREDENTIAL_COLUMNS).eq("organization_id", org).limit(200);
  return (data ?? []).map((row) => ({
    id: row.id,
    membershipId: row.membership_id,
    licenceType: row.licence_type,
    collegeId: row.college_id,
    scopeNote: row.scope_note,
    status: row.status,
    verificationMethod: row.verification_method,
    proofLocator: row.proof_locator,
    sourceUrl: row.source_url,
    registerStatus: row.register_status,
    entitlement: row.entitlement_to_practise,
    restricted: row.discipline_restricted,
    restrictionDetail: row.discipline_restriction_detail,
    declaredAt: row.declared_at,
    checkedAt: row.checked_at,
    nextReviewAt: row.next_review_at,
    validUntil: row.valid_until,
  }));
}

/**
 * The Designer's Licences page for a firm, read as the signed-in staff member. Every staff
 * member reads the firm's credentials and checks (RLS); Add a licence and Report a change are
 * decided by the database (owner, or the holder, with a recent step-up).
 */
export async function loadSheetLicence(staff: SheetStaff, tab: LicenceTab, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [chrome, members, credentials, log, settings] = await Promise.all([
    loadSheetChrome(staff, "/sheet/licence"),
    loadLicenceMembers(supabase, org),
    loadLicenceCredentials(supabase, org),
    supabase.rpc("licence_review_log", { p_organization_id: org }),
    supabase.from("product_settings").select("key, value").in("key", ["licence.recheck_interval", "licence.manual_check_target"]),
  ]);

  const setting = (key: string) => (settings.data ?? []).find((row) => row.key === key)?.value ?? null;
  // app.firm_has_verified_licence: a verified check held by an active consultant or owner.
  const activeLicensed = new Set(members.filter((m) => m.status === "active" && (m.role === "licensed_consultant" || m.role === "firm_owner")).map((m) => m.membershipId));
  const context: LicenceContext = {
    timeZone: staff.timezone,
    now,
    recheckMonths: recheckMonths(setting("licence.recheck_interval")),
    checkTarget: checkTargetLabel(setting("licence.manual_check_target")),
    firmHasVerifiedLicence: credentials.some((credential) => credential.status === "verified" && activeLicensed.has(credential.membershipId)),
    viewerIsOwner: staff.role === "firm_owner",
    organizationId: org,
  };
  const logRows: LicenceLogRow[] = (log.data ?? []).map((row) => ({
    at: row.at,
    kind: row.kind,
    result: row.result,
    credentialId: row.credential_id,
    holderName: row.holder_name,
    collegeId: row.college_id,
    actorName: row.actor_name,
    actorIsPlatform: row.actor_is_platform,
  }));

  const page: LicencesData = {
    firmName: staff.organizationName,
    tab,
    intro: licenceIntro(),
    cards: licenceCards(members, credentials, logRows, context),
    log: licenceLog(logRows, staff.timezone),
  };
  const dialogs: LicenceDialogsData = { ...licenceDialogs(members, credentials, context.viewerIsOwner), organizationId: org };
  return { chrome, page, dialogs, organizationId: org };
}
