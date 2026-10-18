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
import { createClient } from "@/lib/supabase/server";
import { isLicensedMembership, LICENCE_FACT_COLUMNS } from "@/lib/tenant/roles";
import {
  AGREEMENT_CURRENCIES,
  agreementBadge,
  agreementFlags,
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
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import { dayMonth } from "@/modules/sheet/home-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone } from "@/modules/sheet/present";

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
export async function loadSheetAgreements(staff: SheetStaff) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const day = (iso: string) => dayMonth(isoDateInTimeZone(new Date(iso), staff.timezone));

  const [chrome, agreements, templates, matters, own] = await Promise.all([
    loadSheetChrome(staff, "/sheet/agreements"),
    supabase
      .from("agreements")
      .select("id, matter_id, kind, title, status, template_id, current_version_id, created_at, updated_at")
      .eq("organization_id", org)
      .order("updated_at", { ascending: false })
      .limit(AGREEMENTS_READ),
    supabase.from("agreement_templates").select("id, kind, name, status, version").eq("organization_id", org).order("created_at").limit(200),
    supabase
      .from("matters")
      .select("id, reference, title, stage, is_sample")
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
      record: { href: matterHref(row.matter_id), left: row.title, right: number ? `v${number}` : kindLabel(row.kind) },
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
      href: firstWaiting ? matterHref(firstWaiting.matter_id) : "/sheet/agreements",
      label: "Waiting for signatures",
      count: waiting.length,
      note: firstWaiting
        ? latest.get(firstWaiting.id)?.expires_at
          ? { left: clientOf(firstWaiting.matter_id), right: `expires ${day(latest.get(firstWaiting.id)?.expires_at as string)}` }
          : clientOf(firstWaiting.matter_id)
        : "Nothing out for signature",
    },
    {
      href: firstExecuted ? matterHref(firstExecuted.matter_id) : "/sheet/agreements",
      label: "Executed",
      count: executed.length,
      note: firstExecuted
        ? { left: clientOf(firstExecuted.matter_id), right: latest.get(firstExecuted.id)?.completed_at ? day(latest.get(firstExecuted.id)?.completed_at as string) : "signed" }
        : "None signed yet",
    },
    {
      href: firstUnsent ? matterHref(firstUnsent.matter_id) : "/sheet/agreements",
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
  const header: AgreementsHeaderData = { records: rows.length, waiting: waiting.length, create: "New agreement" };
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
  return { chrome, header, page, dialog, templateDialog, countersign };
}
