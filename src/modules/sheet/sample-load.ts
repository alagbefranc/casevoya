import "server-only";
import type { SampleCaseData } from "@/components/sheet/designer/sample-case";
import { createClient } from "@/lib/supabase/server";
import { matterNames } from "@/modules/sheet/chrome-load";
import { loadSheetHome } from "@/modules/sheet/home-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { doneSteps, licenceCheckWords, sampleSteps, trialDaysLeft, type SampleFacts } from "@/modules/sheet/sample-present";
import { loadSheetSetup } from "@/modules/sheet/setup-load";

type Client = Awaited<ReturnType<typeof createClient>>;

/** What happened on the sample matter, from its own records (RLS: what this person can read). */
async function sampleFacts(supabase: Client, org: string, matterId: string | null): Promise<SampleFacts> {
  const none: SampleFacts = { intakeSent: false, agreementSent: false, uploadReviewed: false, reminderScheduled: false, invoiceIssued: false, exportMade: false };
  if (!matterId) return none;
  const [intake, agreements, invoices, exports, deadlines, refs] = await Promise.all([
    supabase.from("intake_responses").select("id").eq("organization_id", org).eq("matter_id", matterId).limit(1),
    supabase.from("agreements").select("id").eq("organization_id", org).eq("matter_id", matterId).neq("status", "draft").limit(1),
    supabase.from("invoices").select("id").eq("organization_id", org).eq("matter_id", matterId).neq("status", "draft").limit(1),
    supabase.from("matter_exports").select("id").eq("organization_id", org).eq("matter_id", matterId).eq("status", "ready").limit(1),
    supabase.from("deadlines").select("id").eq("organization_id", org).eq("matter_id", matterId).limit(50),
    supabase.from("document_matter_refs").select("document_id").eq("organization_id", org).eq("matter_id", matterId).limit(200),
  ]);
  const deadlineIds = (deadlines.data ?? []).map((row) => row.id);
  const documentIds = (refs.data ?? []).map((row) => row.document_id);
  const [reminders, reviewed] = await Promise.all([
    deadlineIds.length ? supabase.from("reminder_schedules").select("id").eq("organization_id", org).in("deadline_id", deadlineIds).limit(1) : null,
    documentIds.length
      ? supabase.from("document_versions").select("id").eq("organization_id", org).in("document_id", documentIds).in("review_state", ["accepted", "rejected"]).limit(1)
      : null,
  ]);
  return {
    intakeSent: Boolean(intake.data?.length),
    agreementSent: Boolean(agreements.data?.length),
    uploadReviewed: Boolean(reviewed?.data?.length),
    reminderScheduled: Boolean(reminders?.data?.length),
    invoiceIssued: Boolean(invoices.data?.length),
    exportMade: Boolean(exports.data?.length),
  };
}

/**
 * The sample-mode page: the home page plus the firm's real sample case and the sample proofs it
 * has recorded. The sample case is created on first visit for firms set up before it existed.
 */
export async function loadSheetSample(staff: SheetStaff, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const [base, ensured, proofs, subscription, credential, setup] = await Promise.all([
    loadSheetHome(staff, now),
    supabase.rpc("ensure_sample_case"),
    supabase.from("sample_proof_steps").select("step").eq("organization_id", org),
    supabase.from("organization_subscriptions").select("status, trial_ends_at").eq("organization_id", org).maybeSingle(),
    supabase
      .from("consultant_credentials")
      .select("status, membership_id")
      .eq("organization_id", org)
      .order("declared_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Sample mode only: the go-live checklist (the owner's licence on file and not blocked, an ended trial).
    loadSheetSetup(supabase, staff),
  ]);
  const matterId = typeof ensured.data === "string" ? ensured.data : null;
  const [name, facts] = await Promise.all([matterId ? matterNames(supabase, org, [matterId]) : null, sampleFacts(supabase, org, matterId)]);
  const applicant = (name ? name(matterId) : "the sample").split(/\s+/)[0] || "the sample";

  let holder: string | null = null;
  if (credential.data?.membership_id) {
    const { data: member } = await supabase.from("memberships").select("user_id").eq("id", credential.data.membership_id).maybeSingle();
    const { data: profile } = member ? await supabase.from("profiles").select("display_name").eq("id", member.user_id).maybeSingle() : { data: null };
    holder = profile?.display_name || staff.displayName;
  }

  const sample: SampleCaseData = {
    applicant,
    steps: sampleSteps(matterId, staff.organizationName, applicant, doneSteps(facts, (proofs.data ?? []).map((row) => row.step as string))),
    licence: credential.data && holder ? { holder, status: licenceCheckWords(credential.data.status) } : null,
    live: setup
      ? {
          licence: {
            added: setup.state.hasCredential,
            blocked: setup.state.hasCredential && !setup.state.licenceOk,
            status: credential.data ? licenceCheckWords(credential.data.status) : null,
          },
          trialEnded: setup.state.trialEnded,
          remaining: setup.state.remaining.map((step) => step.label),
          owner: staff.role === "firm_owner",
        }
      : null,
    // A live firm taking the optional tour: its invitations are open.
    firmLive: !staff.sampleMode,
  };

  const days = subscription.data?.status === "trial" ? trialDaysLeft(subscription.data.trial_ends_at, now) : null;
  const firstName = staff.displayName.split(/\s+/)[0] || staff.displayName;
  return {
    chrome: {
      ...base.chrome,
      // The Finish setup banner links to this page, so it isn't shown here.
      statusbar: { ...base.chrome.statusbar, setup: null },
      sidebar: { ...base.chrome.sidebar, active: "/sheet/sample-mode" },
      top: { ...base.chrome.top, pills: [...(days != null ? [{ left: "Trial", right: `${days} ${days === 1 ? "day" : "days"} left`, tint: true as const }] : []), ...base.chrome.top.pills] },
    },
    rbar: base.rbar,
    home: {
      ...base.home,
      greeting: `Welcome to ${staff.organizationName}, ${firstName}.`,
      summary: staff.sampleMode
        ? "You’re exploring with sample data. Everyone here is fictional, so nothing you send reaches a real person."
        : "This is the optional practice tour. The sample case is fictional, so nothing you send from it reaches a real person.",
    },
    sample,
  };
}
