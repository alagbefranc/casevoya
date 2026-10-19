import "server-only";
import type {
  AgreementRow,
  AgreementsData,
  AgreementsHeaderData,
  AgreementsKpi,
  CountersignDialogData,
  NewAgreementDialogData,
  TemplateDialogData,
} from "@/components/sheet/designer/agreements";
import type {
  AgreementsPendingData,
  AuthorityData,
  AuthorityDialogData,
  AuthorityRow,
  EnvelopeAction,
  EnvelopeStep,
  EnvelopeViewData,
} from "@/components/sheet/designer/agreements-live";
import type { CompareViewData } from "@/components/sheet/designer/agreements-compare";
import type { AgreementsPickData, NewQuoteDialogData } from "@/components/sheet/designer/agreements-quote";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { isLicensedMembership, LICENCE_FACT_COLUMNS } from "@/lib/tenant/roles";
import {
  AGREEMENT_CURRENCIES,
  agreementBadge,
  agreementEnvelopeHref,
  agreementFlags,
  agreementPdfHref,
  agreementsTab,
  AUTHORITY_NEEDED,
  authorityBadge,
  authorityStillNeeded,
  authorityValue,
  COUNTERSIGN_BADGE,
  countersignDialogData,
  countersignDialogId,
  countersignTurn,
  esignConsent,
  isSendableKind,
  kindLabel,
  SENDABLE_KINDS,
  signersFor,
  templateDefaults,
} from "@/modules/sheet/agreements-present";
import {
  type AgreementsContext,
  type EditorViewLoad,
  loadCompareView,
  loadEditorView,
  loadQuoteView,
  newQuoteDialogData,
  pickList,
  type QuoteViewLoad,
} from "@/modules/sheet/agreements-views-load";
import { agreementViewHref } from "@/modules/sheet/agreements-views-present";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import { dayMonth } from "@/modules/sheet/home-present";
import { sentWhen } from "@/modules/sheet/inbox-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone, type SheetQuery } from "@/modules/sheet/present";

/** A firm's agreements are read once; each row is small. */
const AGREEMENTS_READ = 500;
const MATTERS_READ = 1000;

const WAITING = new Set(["sent", "partially_signed"]);

type EnvelopeRow = {
  id: string;
  agreement_id: string;
  status: string;
  expires_at: string;
  sent_at: string;
  completed_at: string | null;
  content_sha256: string;
};

/**
 * The Designer's Agreements page (All agreements) for a firm, read as the signed-in staff member.
 * RLS decides what is visible: staff with aal2 in a role that reads the matter.
 */
export async function loadSheetAgreements(staff: SheetStaff, query: SheetQuery = {}) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const tab = agreementsTab(query.tab);
  const today = isoDateInTimeZone(new Date(), staff.timezone);
  const day = (iso: string) => dayMonth(isoDateInTimeZone(new Date(iso), staff.timezone));

  const [chrome, agreements, templates, matters, own] = await Promise.all([
    loadSheetChrome(staff, "/sheet/agreements"),
    supabase
      .from("agreements")
      .select("id, matter_id, kind, title, status, template_id, current_version_id, created_at, updated_at")
      .eq("organization_id", org)
      .order("updated_at", { ascending: false })
      .limit(AGREEMENTS_READ),
    supabase.from("agreement_templates").select("id, kind, name, status, version, approved_at").eq("organization_id", org).order("created_at").limit(200),
    supabase
      .from("matters")
      .select("id, reference, title, stage, is_sample, responsible_consultant_membership_id")
      .eq("organization_id", org)
      .neq("stage", "closed")
      .order("updated_at", { ascending: false })
      .limit(MATTERS_READ),
    supabase.from("memberships").select("id, role").eq("id", staff.membershipId).maybeSingle(),
  ]);
  const rows = agreements.data ?? [];
  const agreementIds = rows.map((row) => row.id);
  const versionIds = rows.map((row) => row.current_version_id).filter((id): id is string => Boolean(id));
  const matterRows = matters.data ?? [];
  const matterIds = [...new Set([...rows.map((row) => row.matter_id), ...matterRows.map((row) => row.id)])];
  // Each template starts the New agreement dialog with the terms of the firm's latest agreement
  // made from it (templates keep only their text).
  const lastFromTemplate = new Map<string, string>();
  for (const row of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (row.template_id && row.current_version_id && !lastFromTemplate.has(row.template_id)) {
      lastFromTemplate.set(row.template_id, row.current_version_id);
    }
  }
  const termVersionIds = [...new Set(lastFromTemplate.values())];

  const [envelopes, versions, participants, refs, credential, termVersions] = await Promise.all([
    agreementIds.length
      ? supabase
          .from("signature_envelopes")
          .select("id, agreement_id, status, expires_at, sent_at, completed_at, content_sha256")
          .eq("organization_id", org)
          .in("agreement_id", agreementIds)
          .order("sent_at", { ascending: false })
      : null,
    versionIds.length ? supabase.from("agreement_versions").select("id, version_number").eq("organization_id", org).in("id", versionIds) : null,
    matterIds.length
      ? supabase.from("matter_participants").select("matter_id, person_id, role").eq("organization_id", org).in("matter_id", matterIds).not("person_id", "is", null)
      : null,
    matterIds.length ? supabase.from("matters").select("id, reference, title").eq("organization_id", org).in("id", matterIds) : null,
    own.data?.role === "firm_owner"
      ? supabase.from("consultant_credentials").select(`membership_id, ${LICENCE_FACT_COLUMNS}`).eq("organization_id", org).eq("membership_id", staff.membershipId).maybeSingle()
      : null,
    termVersionIds.length
      ? supabase
          .from("agreement_versions")
          .select("id, exclusions, refund_policy, fee_cents, currency, government_fee_note")
          .eq("organization_id", org)
          .in("id", termVersionIds)
      : null,
  ]);
  const termsById = new Map((termVersions?.data ?? []).map((row) => [row.id, row]));
  const defaultsFor = (templateId: string) => {
    const versionId = lastFromTemplate.get(templateId);
    return templateDefaults(versionId ? termsById.get(versionId) : null);
  };

  const latest = new Map<string, EnvelopeRow>();
  for (const row of envelopes?.data ?? []) if (!latest.has(row.agreement_id)) latest.set(row.agreement_id, row);
  const envelopeIds = [...latest.values()].map((row) => row.id);

  const personIds = [...new Set((participants?.data ?? []).map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
  const [signers, people, consentSetting] = await Promise.all([
    envelopeIds.length
      ? supabase.from("envelope_signers").select("envelope_id, status, membership_id").eq("organization_id", org).in("envelope_id", envelopeIds)
      : null,
    personIds.length ? supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", personIds) : null,
    supabase.from("product_settings").select("value").eq("key", "agreements.esign_consent").maybeSingle(),
  ]);
  const consent = esignConsent(consentSetting.data?.value);

  const versionNumber = new Map((versions?.data ?? []).map((row) => [row.id, row.version_number]));
  const personName = new Map((people?.data ?? []).map((row) => [row.id, row.display_name]));
  const matterRef = new Map((refs?.data ?? []).map((row) => [row.id, row]));
  const partiesOf = new Map<string, { person_id: string | null; role: string }[]>();
  for (const row of participants?.data ?? []) {
    const list = partiesOf.get(row.matter_id) ?? [];
    list.push(row);
    partiesOf.set(row.matter_id, list);
  }
  const clientOf = (matterId: string) => {
    const parties = partiesOf.get(matterId) ?? [];
    const applicant = parties.find((row) => row.role === "applicant" && row.person_id && personName.get(row.person_id));
    const any = parties.find((row) => row.person_id && personName.get(row.person_id));
    const pick = applicant ?? any;
    return (pick?.person_id && personName.get(pick.person_id)) || matterRef.get(matterId)?.title || "Matter";
  };
  const referenceOf = (matterId: string) => matterRef.get(matterId)?.reference || "—";
  const matterHref = (matterId: string) => `/sheet/matters/${matterId}?tab=agreements`;
  const signerCount = new Map<string, { signed: number; total: number }>();
  for (const row of signers?.data ?? []) {
    const count = signerCount.get(row.envelope_id) ?? { signed: 0, total: 0 };
    count.total += 1;
    if (row.status === "signed") count.signed += 1;
    signerCount.set(row.envelope_id, count);
  }

  // Envelopes where the signed-in staff member is the current signer: their turn to countersign.
  const signerRows = signers?.data ?? [];
  const countersign: CountersignDialogData[] = [];
  const tableRows: AgreementRow[] = rows.map((row) => {
    const envelope = latest.get(row.id);
    const count = envelope ? signerCount.get(envelope.id) : undefined;
    const number = row.current_version_id ? versionNumber.get(row.current_version_id) : undefined;
    const turn = Boolean(envelope && WAITING.has(envelope.status) && countersignTurn(signerRows, envelope.id, staff.membershipId));
    if (turn && envelope) {
      countersign.push(
        countersignDialogData({
          organizationId: org,
          envelopeId: envelope.id,
          title: row.title,
          versionNumber: number,
          client: clientOf(row.matter_id),
          matter: referenceOf(row.matter_id),
          contentSha: envelope.content_sha256,
          signed: count?.signed ?? 0,
          total: count?.total ?? 0,
          consent,
        }),
      );
    }
    let date: AgreementRow["date"] = day(row.updated_at);
    if (row.status === "completed" && envelope?.completed_at) date = day(envelope.completed_at);
    else if (WAITING.has(row.status) && envelope?.expires_at) date = `Expires ${day(envelope.expires_at)}`;
    else if (row.status === "draft") date = { left: day(row.created_at), right: "not sent" };
    else if (["declined", "voided", "expired", "superseded"].includes(row.status)) date = { left: day(row.updated_at), right: "history kept" };
    return {
      key: row.id,
      flags: agreementFlags(row.status, row.kind),
      client: { name: clientOf(row.matter_id) },
      matter: referenceOf(row.matter_id),
      // The agreement's own view: a quote in the Quote builder, an unsent draft in the Agreement
      // editor, anything sent in Envelope (signers, events, signed copies).
      record: { href: agreementViewHref(row, Boolean(envelope)), left: row.title, right: number ? `v${number}` : kindLabel(row.kind) },
      state: turn ? COUNTERSIGN_BADGE : agreementBadge(row.status, row.kind),
      signed: count ? `${count.signed} of ${count.total}` : "—",
      date,
      ...(turn && envelope ? { action: { label: "Countersign", dialog: countersignDialogId(envelope.id) } } : {}),
    };
  });

  const templateRows = templates.data ?? [];
  const approved = templateRows.filter((row) => row.status === "approved" && isSendableKind(row.kind));
  const drafts = templateRows.filter((row) => row.status === "draft");
  const waiting = rows.filter((row) => WAITING.has(row.status));
  const executed = rows.filter((row) => row.status === "completed");
  const unsent = rows.filter((row) => row.status === "draft");
  const firstWaiting = waiting[0];
  const firstExecuted = executed[0];
  const firstUnsent = unsent[0];

  const kpis: AgreementsKpi[] = [
    {
      href: firstWaiting ? agreementEnvelopeHref(firstWaiting.id) : "/sheet/agreements",
      label: "Waiting for signatures",
      count: waiting.length,
      note: firstWaiting
        ? latest.get(firstWaiting.id)?.expires_at
          ? { left: clientOf(firstWaiting.matter_id), right: `expires ${day(latest.get(firstWaiting.id)?.expires_at as string)}` }
          : clientOf(firstWaiting.matter_id)
        : "Nothing out for signature",
    },
    {
      href: firstExecuted ? agreementEnvelopeHref(firstExecuted.id) : "/sheet/agreements",
      label: "Executed",
      count: executed.length,
      note: firstExecuted
        ? { left: clientOf(firstExecuted.matter_id), right: latest.get(firstExecuted.id)?.completed_at ? day(latest.get(firstExecuted.id)?.completed_at as string) : "signed" }
        : "None signed yet",
    },
    {
      // Save as draft in the New agreement dialog makes these; each opens to Send for signature.
      href: firstUnsent ? agreementEnvelopeHref(firstUnsent.id) : "/sheet/agreements",
      label: "Drafts not sent",
      count: unsent.length,
      warn: unsent.length > 0,
      note: firstUnsent ? { left: clientOf(firstUnsent.matter_id), right: firstUnsent.title } : "No drafts",
    },
    {
      href: "#",
      dialog: "dlgTpl",
      label: "Approved templates",
      count: approved.length,
      warn: approved.length === 0,
      note: drafts.length ? `${drafts.length} waiting for approval` : approved.length ? "Ready to send" : "None approved yet",
    },
  ];

  const noTemplate = approved.length === 0;
  const page: AgreementsData = {
    kpis,
    rows: tableRows,
    filterEmpty: true,
    empty:
      tableRows.length === 0
        ? noTemplate
          ? {
              title: "No agreements yet",
              copy: drafts.length
                ? "A template is waiting for a licensed consultant to approve it. Agreements start from an approved template."
                : "Agreements start from an approved template. Add one, then a licensed consultant approves it.",
              action: { label: drafts.length ? "Review templates" : "Add an agreement template", dialog: "dlgTpl" },
            }
          : {
              title: "No agreements yet",
              copy: "Create one from an approved template and send it to the client for signature in their portal.",
              action: { label: "New agreement", dialog: "dlgNewQ" },
            }
        : null,
  };

  const signable = matterRows.filter((row) => signersFor(partiesOf.get(row.id) ?? [], personName).length > 0);
  // The Designer's header button is New quote; on the Quote builder tab it opens the live New
  // quote dialog, elsewhere the New agreement dialog (both are the Designer's #dlgNewQ).
  const header: AgreementsHeaderData = { records: rows.length, waiting: waiting.length, create: tab === "quote" ? "New quote" : "New agreement", tab };
  const templateOptions = approved.map((row) => ({ value: row.id, left: `${row.name} · ${kindLabel(row.kind)}`, defaults: defaultsFor(row.id) }));
  const firstDefaults = templateOptions[0]?.defaults ?? templateDefaults(null);
  const currencies = [...new Set<string>([...AGREEMENT_CURRENCIES, ...templateOptions.map((option) => option.defaults.currency)])];
  const dialog: NewAgreementDialogData = {
    title: "New agreement",
    matterLabel: "Matter",
    templateLabel: "Approved template",
    matters: signable.length
      ? signable.map((row) => ({
          value: row.id,
          left: `${clientOf(row.id)} · ${row.reference ?? row.title}${row.is_sample ? " (sample)" : ""}`,
        }))
      : [{ value: "", left: "No open matter with an applicant" }],
    templates: templateOptions.length ? templateOptions : [{ value: "", left: "No approved template yet" }],
    submit: "Create and send",
    live: {
      organizationId: org,
      sampleMode: staff.sampleMode,
      currencies,
      defaults: firstDefaults,
      blocked: noTemplate
        ? {
            title: "No approved agreement template",
            copy: drafts.length
              ? "A draft template is waiting for a licensed consultant to approve it."
              : "Add a template first. A licensed consultant approves it before it can be sent.",
            action: { label: drafts.length ? "Review templates" : "Add a template", dialog: "dlgTpl" },
          }
        : signable.length === 0
          ? { title: "No matter to send to", copy: "An agreement goes to the matter’s applicant. Open a matter with an applicant first." }
          : null,
    },
  };
  const templateDialog: TemplateDialogData = {
    organizationId: org,
    kinds: SENDABLE_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) })),
    drafts: drafts.map((row) => ({ id: row.id, name: row.name, kind: kindLabel(row.kind) })),
    canApprove: Boolean(own.data && isLicensedMembership(own.data.role, credential?.data ?? null)),
  };

  const role = own.data?.role ?? staff.role;
  let authority: { page: AuthorityData; dialog: AuthorityDialogData } | null = null;
  if (tab === "authority") {
    authority = await loadAuthority(supabase, staff, today, {
      openMatters: matterRows,
      partiesOf,
      personName,
      clientOf,
      referenceOf,
      canRecord: AUTHORITY_ROLES.has(role),
    });
  }
  let envelope: { page: EnvelopeViewData; voidDialog: { organizationId: string; envelopeId: string; who: string } | null } | null = null;
  let pending: AgreementsPendingData | null = null;
  // Quote builder, Agreement editor and Compare versions: one agreement (`?view=<id>`), or the
  // list to pick from. The Quote builder's New quote dialog needs a matter with an applicant.
  const viewId = query.view && isUuid(query.view) ? query.view : null;
  const views: AgreementsContext = {
    clientOf,
    referenceOf,
    matterTitleOf: (matterId) => matterRef.get(matterId)?.title || "Matter",
    templates: templateRows,
    envelopeOf: (agreementId) => latest.get(agreementId),
    canQuote: QUOTE_ROLES.has(role),
    canEdit: SEND_ROLES.has(role),
    today,
  };
  let quote: QuoteViewLoad | null = null;
  let editor: EditorViewLoad | null = null;
  let compare: { page: CompareViewData } | null = null;
  let pick: AgreementsPickData | null = null;
  let newQuote: NewQuoteDialogData | null = null;
  if (tab === "quote" || tab === "editor" || tab === "compare") {
    if (viewId) {
      if (tab === "quote") quote = await loadQuoteView(supabase, staff, viewId, views);
      else if (tab === "editor") editor = await loadEditorView(supabase, staff, viewId, views);
      else compare = await loadCompareView(supabase, staff, viewId, views);
    }
    if (!quote && !editor && !compare) {
      pick = pickList(
        tab,
        rows,
        (agreementId) => {
          const row = rows.find((candidate) => candidate.id === agreementId);
          return row?.current_version_id ? versionNumber.get(row.current_version_id) : undefined;
        },
        views,
      );
    }
    if (tab === "quote") newQuote = newQuoteDialogData(staff, dialog.matters.map((option) => ({ value: option.value ?? "", left: option.left })), views);
  }
  if (tab === "envelope") {
    const agreementId = query.view && isUuid(query.view) ? query.view : null;
    envelope = agreementId
      ? await loadEnvelope(supabase, staff, agreementId, {
          clientOf,
          referenceOf,
          matterHref,
          turn: (envelopeId) => countersign.some((sign) => sign.envelopeId === envelopeId),
          canSend: SEND_ROLES.has(role),
        })
      : null;
    if (!envelope) pending = ENVELOPE_PICK;
  }
  return { chrome, header, page, dialog, templateDialog, countersign, tab, authority, envelope, pending, quote, editor, compare, pick, newQuote };
}

/** Who records representation authority (the database's app.record_representation_authority). */
const AUTHORITY_ROLES = new Set(["firm_owner", "licensed_consultant"]);
/** Who sends and voids agreements (send_agreement, void_agreement_envelope), and edits clauses. */
const SEND_ROLES = new Set(["firm_owner", "licensed_consultant", "case_manager"]);
/** Who builds, sends and converts quotes (app.require_licensed_staff: a licensed consultant, or the owner). */
const QUOTE_ROLES = new Set(["firm_owner", "licensed_consultant"]);

const ENVELOPE_PICK: AgreementsPendingData = {
  title: "Envelope",
  intro: "One agreement’s signers, signing events, hash and signed copies.",
  empty: { title: "Choose an agreement", copy: "Open an agreement from All agreements to see its envelope." },
  action: { label: "All agreements", href: "/sheet/agreements" },
};

type Client = Awaited<ReturnType<typeof createClient>>;

/** "16 Oct 2026" for a firm-day date. */
function longDay(date: string): string {
  const [year] = date.split("-");
  return `${dayMonth(date)} ${year}`;
}

/**
 * The Representation authority tab: authority on file (public.representation_authorities, RLS)
 * and the open matters before submission with nobody's authority on file yet (sign-off needs one).
 */
async function loadAuthority(
  supabase: Client,
  staff: SheetStaff,
  today: string,
  ctx: {
    openMatters: { id: string; reference: string | null; title: string; stage: string; is_sample: boolean }[];
    partiesOf: Map<string, { person_id: string | null; role: string }[]>;
    personName: Map<string, string>;
    clientOf: (matterId: string) => string;
    referenceOf: (matterId: string) => string;
    canRecord: boolean;
  },
): Promise<{ page: AuthorityData; dialog: AuthorityDialogData }> {
  const org = staff.organizationId;
  const found = await supabase
    .from("representation_authorities")
    .select("id, matter_id, person_id, scope, evidence_locator, effective_on, revoked_at, revocation_reason, created_at")
    .eq("organization_id", org)
    .order("created_at", { ascending: false })
    .limit(500);
  const records = found.data ?? [];
  const missing = [...new Set(records.map((row) => row.person_id).filter((id) => !ctx.personName.has(id)))];
  const more = missing.length ? await supabase.from("persons").select("id, display_name").eq("organization_id", org).in("id", missing) : null;
  const nameOf = (id: string) => ctx.personName.get(id) ?? (more?.data ?? []).find((row) => row.id === id)?.display_name ?? "Client";

  const rows: AuthorityRow[] = records.map((row) => ({
    key: row.id,
    client: { name: nameOf(row.person_id) },
    scope: `${row.scope}, ${ctx.referenceOf(row.matter_id)}`,
    evidence: row.revoked_at ? `Revoked, ${dayMonth(isoDateInTimeZone(new Date(row.revoked_at), staff.timezone))}` : row.evidence_locator,
    effective: row.revoked_at
      ? `${longDay(row.effective_on)} – ${longDay(isoDateInTimeZone(new Date(row.revoked_at), staff.timezone))}`
      : longDay(row.effective_on),
    state: authorityBadge(row, today),
  }));
  const covered = new Set(records.filter((row) => !row.revoked_at).map((row) => row.matter_id));
  for (const matter of ctx.openMatters) {
    if (covered.has(matter.id) || !authorityStillNeeded(matter.stage)) continue;
    if (!(ctx.partiesOf.get(matter.id) ?? []).some((party) => party.person_id)) continue;
    rows.push({
      key: `needed-${matter.id}`,
      client: { name: ctx.clientOf(matter.id) },
      scope: `${matter.title}${matter.is_sample ? " (sample)" : ""}`,
      evidence: "—",
      effective: "—",
      state: AUTHORITY_NEEDED,
    });
  }

  const clients: AuthorityDialogData["clients"] = [];
  for (const matter of ctx.openMatters) {
    const parties = [...(ctx.partiesOf.get(matter.id) ?? [])].sort((a, b) => Number(b.role === "applicant") - Number(a.role === "applicant"));
    for (const party of parties) {
      if (!party.person_id || !ctx.personName.has(party.person_id)) continue;
      clients.push({
        value: authorityValue(matter.id, party.person_id),
        label: `${ctx.personName.get(party.person_id)} · ${matter.reference ?? matter.title}${matter.is_sample ? " (sample)" : ""}`,
      });
    }
  }
  const why = ctx.canRecord ? null : "Only the firm owner or a licensed consultant records representation authority";
  return {
    page: {
      rows,
      empty: rows.length
        ? null
        : {
            title: "No representation authority yet",
            copy: "Record the signed government form, or other authority to represent a client, before a submission is signed off. A signed service agreement doesn’t record it.",
          },
      record: { disabled: !ctx.canRecord, why },
    },
    dialog: {
      organizationId: org,
      clients,
      today,
      blocked: ctx.canRecord ? null : { title: "Firm owner or licensed consultant only", copy: `${why}.` },
    },
  };
}

const EVENT_LABEL: Record<string, string> = {
  sent: "Envelope sent",
  signed: "signed",
  declined: "declined",
  voided: "Envelope voided",
  expired: "Envelope expired",
  completed: "Everyone signed",
  superseded: "Replaced by a new version",
  replayed: "Same event received twice",
};

function shortHash(sha: string | null | undefined): string | null {
  return sha && /^[0-9a-f]{64}$/.test(sha) ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : null;
}

/** One agreement's own view: its latest envelope, signers in order, signing events, hash and copies. */
async function loadEnvelope(
  supabase: Client,
  staff: SheetStaff,
  agreementId: string,
  ctx: {
    clientOf: (matterId: string) => string;
    referenceOf: (matterId: string) => string;
    matterHref: (matterId: string) => string;
    turn: (envelopeId: string) => boolean;
    canSend: boolean;
  },
): Promise<{ page: EnvelopeViewData; voidDialog: { organizationId: string; envelopeId: string; who: string } | null } | null> {
  const org = staff.organizationId;
  const found = await supabase.from("agreements").select("id, matter_id, kind, title, status, current_version_id, created_at").eq("organization_id", org).eq("id", agreementId).maybeSingle();
  const agreement = found.data;
  if (!agreement) return null;
  const [version, envelopes] = await Promise.all([
    agreement.current_version_id
      ? supabase.from("agreement_versions").select("version_number, content_sha256").eq("organization_id", org).eq("id", agreement.current_version_id).maybeSingle()
      : null,
    supabase
      .from("signature_envelopes")
      .select("id, status, sent_at, expires_at, completed_at, voided_at, content_sha256")
      .eq("organization_id", org)
      .eq("agreement_id", agreement.id)
      .order("sent_at", { ascending: false })
      .limit(1),
  ]);
  const envelope = envelopes.data?.[0] ?? null;
  const [signers, events] = envelope
    ? await Promise.all([
        supabase
          .from("envelope_signers")
          .select("id, signing_order, display_name, status, signed_at, declined_at")
          .eq("organization_id", org)
          .eq("envelope_id", envelope.id)
          .order("signing_order"),
        supabase.from("signature_events").select("id, kind, signer_id, occurred_at, content_sha256").eq("organization_id", org).eq("envelope_id", envelope.id).order("occurred_at").limit(100),
      ])
    : [null, null];

  const when = (iso: string) => sentWhen(iso, staff.timezone);
  const client = ctx.clientOf(agreement.matter_id);
  const reference = ctx.referenceOf(agreement.matter_id);
  const number = version?.data?.version_number;
  const document = `${agreement.title}${number ? ` v${number}` : ""}`;
  const signerRows = signers?.data ?? [];
  const nameOf = new Map(signerRows.map((row) => [row.id, row.display_name]));
  const signed = signerRows.filter((row) => row.status === "signed").length;
  const steps: EnvelopeStep[] = signerRows.map((row, index) => {
    const first = (name: string) => name.trim().split(/\s+/)[0] || name;
    if (row.status === "signed") return { state: "done", name: row.display_name, note: [`Signed ${row.signed_at ? when(row.signed_at) : ""}`.trim(), "in-house e-signature"] };
    if (row.status === "declined") return { state: "", name: row.display_name, note: [`Declined ${row.declined_at ? when(row.declined_at) : ""}`.trim()] };
    if (row.status === "current" && envelope && ["sent", "partially_signed"].includes(envelope.status)) return { state: "now", name: row.display_name, note: ["Waiting for signature"] };
    const before = signerRows[index - 1];
    return { state: "", name: row.display_name, note: [before ? `After ${first(before.display_name)}` : "First to sign"] };
  });
  const badge = !envelope
    ? null
    : envelope.status === "completed"
      ? { tone: "ok" as const, label: "Executed" }
      : envelope.status === "voided"
        ? { tone: "gr" as const, label: "Voided" }
        : envelope.status === "declined"
          ? { tone: "bad" as const, label: "Declined" }
          : envelope.status === "expired"
            ? { tone: "gr" as const, label: "Expired" }
            : { tone: "blue" as const, label: `${signed} of ${signerRows.length} signed` };
  const eventRows = (events?.data ?? []).map((event) => {
    const hash = shortHash(event.content_sha256);
    const who = event.signer_id ? nameOf.get(event.signer_id) : null;
    const label = EVENT_LABEL[event.kind] ?? event.kind;
    const parts =
      event.kind === "sent" && hash
        ? [label, `document hash ${hash}`]
        : event.kind === "replayed"
          ? [label, "ignored, nothing changed"]
          : who && (event.kind === "signed" || event.kind === "declined")
            ? [`${who} ${label}`]
            : [label.charAt(0).toUpperCase() + label.slice(1)];
    return { key: event.id, when: when(event.occurred_at), event: parts, id: event.id.slice(0, 8) };
  });

  const waiting = Boolean(envelope && ["sent", "partially_signed"].includes(envelope.status));
  const actions: EnvelopeAction[] = [];
  if (envelope?.status === "completed") {
    actions.push({ label: "Download signed PDF", primary: true, href: agreementPdfHref(envelope.id, org, "executed") });
    actions.push({ label: "Download completion certificate", href: agreementPdfHref(envelope.id, org, "certificate") });
  }
  if (envelope && waiting && ctx.turn(envelope.id)) actions.push({ label: "Countersign", primary: true, attrs: { "data-dlg": countersignDialogId(envelope.id) } });
  if (!envelope && agreement.status === "draft" && ctx.canSend && isSendableKind(agreement.kind)) {
    actions.push({ label: "Send for signature", primary: true, attrs: { "data-agreement-send": agreement.id, "data-org": org } });
  }
  if (envelope && waiting && ctx.canSend) actions.push({ label: "Void envelope", attrs: { "data-dlg": "dlgVoid" } });
  actions.push({ label: "Open the matter", href: ctx.matterHref(agreement.matter_id) });

  const state = agreement.status === "draft" ? "Saved as a draft. Not sent yet." : `${agreementBadge(agreement.status, agreement.kind).label}.`;
  const current = signerRows.find((row) => row.status === "current");
  return {
    page: {
      title: `${document} (${client})`,
      intro: `${kindLabel(agreement.kind)} on ${reference}. ${state}${envelope && waiting ? ` Expires ${firmDayMonth(envelope.expires_at, staff.timezone)}.` : ""}`,
      signers: {
        badge,
        steps,
        empty: envelope ? null : "Nobody has been asked to sign yet. Send it for signature: the applicant signs first, then the sponsor, then the consultant for the firm.",
      },
      events: eventRows,
      integrity: [
        { term: "Document", value: document },
        { term: "Hash", value: shortHash(envelope?.content_sha256 ?? version?.data?.content_sha256) ? `${shortHash(envelope?.content_sha256 ?? version?.data?.content_sha256)} (SHA-256)` : "Locked when it is sent" },
        { term: "If fees change", value: "The envelope is voided and a new version is sent, even after someone signs" },
        { term: "When complete", value: "The signed PDF and completion certificate are stored on the matter and in each signer’s portal" },
      ],
      actions,
      note:
        envelope?.status === "completed"
          ? "The executed original can’t be edited."
          : waiting
            ? "Casevoya doesn’t send signing reminders from here yet; the signer sees the agreement in their portal."
            : "History is kept for every envelope, signed or not.",
    },
    voidDialog: envelope && waiting && ctx.canSend ? { organizationId: org, envelopeId: envelope.id, who: current?.display_name ?? client } : null,
  };
}

function firmDayMonth(iso: string, timeZone: string): string {
  return dayMonth(isoDateInTimeZone(new Date(iso), timeZone));
}
