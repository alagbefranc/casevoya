import "server-only";
import type { CompareViewData } from "@/components/sheet/designer/agreements-compare";
import type { ClauseDialogData, DdPart, EditorClause, EditorViewData } from "@/components/sheet/designer/agreements-editor";
import type {
  AgreementsPickData,
  NewQuoteDialogData,
  QuoteConvertDialogData,
  QuoteEditDialogData,
  QuoteLineView,
  QuotePreviewDialogData,
  QuoteViewData,
} from "@/components/sheet/designer/agreements-quote";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { createClient } from "@/lib/supabase/server";
import { agreementBadge, esignConsent, kindLabel } from "@/modules/sheet/agreements-present";
import {
  agreementTabHref,
  amountInput,
  amountMajor,
  bpsToPercent,
  clauseSummary,
  compareSections,
  paidAsParts,
  quoteCategoryLabel,
  quoteTotals,
  textParts,
  versionBadge,
  versionStateBadge,
  versionStateWords,
} from "@/modules/sheet/agreements-views-present";
import { dayMonth } from "@/modules/sheet/home-present";
import { sentWhen } from "@/modules/sheet/inbox-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone } from "@/modules/sheet/present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** What the Agreements page already knows about the firm, shared with these tab loaders. */
export type AgreementsContext = {
  clientOf: (matterId: string) => string;
  referenceOf: (matterId: string) => string;
  matterTitleOf: (matterId: string) => string;
  /** The firm's approved templates, by kind. */
  templates: { id: string; kind: string; name: string; status: string; version: number; approved_at?: string | null }[];
  /** The latest envelope of each agreement. */
  envelopeOf: (agreementId: string) => { id: string; status: string } | undefined;
  /** The signed-in member may build, send and convert quotes (licensed consultant or owner). */
  canQuote: boolean;
  /** The signed-in member may edit clauses and void (owner, licensed consultant, case manager). */
  canEdit: boolean;
  today: string;
};

const WAITING = new Set(["sent", "partially_signed"]);

function longDay(date: string): string {
  const [year] = date.split("-");
  return `${dayMonth(date)} ${year}`;
}

function firmLongDay(iso: string, timeZone: string): string {
  return longDay(isoDateInTimeZone(new Date(iso), timeZone));
}

function shortHash(sha: string | null | undefined): string | null {
  return sha && /^[0-9a-f]{64}$/.test(sha) ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : null;
}

/** The display names of staff users (profiles) for who entered a government fee. */
async function userNames(supabase: Client, org: string, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const profiles = await supabase.from("profiles").select("id, display_name").in("id", ids);
  return new Map((profiles.data ?? []).map((row) => [row.id, row.display_name || "Staff"]));
}

export type QuoteViewLoad = {
  page: QuoteViewData;
  edit: QuoteEditDialogData | null;
  preview: QuotePreviewDialogData;
  convert: QuoteConvertDialogData | null;
};

/** One quote (the Designer's Quote builder tab) from agreements, agreement_versions, quote_lines and quote_instalments. */
export async function loadQuoteView(supabase: Client, staff: SheetStaff, agreementId: string, ctx: AgreementsContext): Promise<QuoteViewLoad | null> {
  const org = staff.organizationId;
  const found = await supabase
    .from("agreements")
    .select("id, matter_id, kind, title, status, current_version_id, quote_expires_on, created_at, updated_at, accepted_at")
    .eq("organization_id", org)
    .eq("id", agreementId)
    .maybeSingle();
  const agreement = found.data;
  if (!agreement || agreement.kind !== "quote" || !agreement.current_version_id) return null;
  const [version, lines, instalments, matter] = await Promise.all([
    supabase
      .from("agreement_versions")
      .select("id, version_number, scope_summary, services, exclusions, deliverables, fee_structure, refund_policy, fee_cents, currency, government_fee_note, locked_at, content_sha256")
      .eq("organization_id", org)
      .eq("id", agreement.current_version_id)
      .maybeSingle(),
    supabase
      .from("quote_lines")
      .select("id, position, category, description, amount_cents, tax_rate_bps, source_note, entered_by, entered_on")
      .eq("organization_id", org)
      .eq("agreement_version_id", agreement.current_version_id)
      .order("position"),
    supabase.from("quote_instalments").select("id, position, label, amount_cents, paid_as").eq("organization_id", org).eq("agreement_version_id", agreement.current_version_id).order("position"),
    supabase.from("matters").select("id, is_sample").eq("organization_id", org).eq("id", agreement.matter_id).maybeSingle(),
  ]);
  const ver = version.data;
  if (!ver) return null;
  const lineRows = lines.data ?? [];
  const instalmentRows = instalments.data ?? [];
  const names = await userNames(
    supabase,
    org,
    lineRows.map((row) => row.entered_by).filter((id): id is string => Boolean(id)),
  );
  const currency = ver.currency;
  const totals = quoteTotals(lineRows);
  const client = ctx.clientOf(agreement.matter_id);
  const firm = staff.organizationName;
  const expiry = agreement.quote_expires_on ? longDay(agreement.quote_expires_on) : "—";
  const expired = Boolean(agreement.quote_expires_on && agreement.quote_expires_on < ctx.today && agreement.status === "sent");

  const status =
    agreement.status === "accepted"
      ? `Accepted by the client${agreement.accepted_at ? ` on ${firmLongDay(agreement.accepted_at, staff.timezone)}` : ""}. Accepting is not signing an agreement.`
      : agreement.status === "sent"
        ? expired
          ? `Sent, and expired on ${expiry}. Edit it to make a new version.`
          : `Sent to the client${ver.locked_at ? ` on ${firmLongDay(ver.locked_at, staff.timezone)}` : ""}; they can accept it in their portal.`
        : "Not sent yet.";
  const intro = `${ctx.matterTitleOf(agreement.matter_id)}. A quote proposes a defined service; the client signs a service agreement after accepting it. ${status}`;

  const government = lineRows.filter((row) => row.category === "government_fee");
  const governmentCopy = government.length
    ? `${government
        .map((row) => {
          const who = row.entered_by ? names.get(row.entered_by) : null;
          const when = row.entered_on ? longDay(row.entered_on) : null;
          return `${currency} ${amountMajor(row.amount_cents, currency)} ${row.description}, entered by hand${row.source_note ? ` from ${row.source_note}` : ""}${when ? ` on ${when}` : ""}${who ? ` (${who})` : ""}.`;
        })
        .join(" ")} Paid by the client to IRCC, never through ${firm}. Recheck before sending.`
    : ver.government_fee_note
      ? `${ver.government_fee_note} No government fee amount is stated on this quote.`
      : `No government fee is entered. Government fees are paid by the client to IRCC, never through ${firm}; enter them from the IRCC fee list with the date you checked, or they stay unstated.`;

  const lineViews: QuoteLineView[] = lineRows
    .filter((row) => row.category !== "government_fee")
    .map((row) => ({
      key: row.id,
      category: quoteCategoryLabel(row.category),
      description: textParts(row.description),
      amount: amountMajor(row.amount_cents, currency),
    }));
  const instalmentViews = instalmentRows.map((row) => ({ key: row.id, when: row.label, amount: amountMajor(row.amount_cents, currency), paidAs: paidAsParts(row.paid_as) }));
  const refund = ver.refund_policy ?? "No refund policy is stated on this quote. Your professional reviewer owns the wording; add it in Edit quote.";

  const serviceTemplates = ctx.templates.filter((row) => row.status === "approved" && row.kind === "service");
  const convertible = ctx.canQuote && (agreement.status === "sent" || agreement.status === "accepted");
  const convertBlocked = !ctx.canQuote
    ? "Only a licensed consultant or the firm owner turns a quote into an agreement"
    : agreement.status === "draft"
      ? "Send the quote first"
      : agreement.status !== "sent" && agreement.status !== "accepted"
        ? "This quote is closed"
        : null;
  const canEditQuote = ctx.canQuote && agreement.status !== "accepted";

  const page: QuoteViewData = {
    title: agreement.title,
    client,
    intro,
    facts: {
      scope: ver.scope_summary,
      services: textParts(ver.services, "Not listed yet"),
      exclusions: ver.exclusions ?? "Nothing excluded yet",
      deliverables: textParts(ver.deliverables, "Not listed yet"),
      feeStructure: ver.fee_structure ?? "Not stated",
      expiry: { date: expiry, note: expired ? "expired; a new version needs a new expiry" : "after that the quote needs a new version" },
    },
    currency,
    lines: lineViews,
    total: { label: `Total to ${firm}`, amount: amountMajor(totals.firmCents, currency) },
    government: { title: "Government fees are separate", copy: governmentCopy },
    instalments: instalmentViews,
    instalmentsEmpty: instalmentRows.length ? null : "No instalments yet. Add them in Edit quote: “On signing”, then each milestone, adding up to the total to the firm.",
    instalmentsNote: `Money paid before work is done is an advance. It sits in the client account until ${firm} invoices delivered work.`,
    refund,
    actions: {
      edit: canEditQuote ? { label: "Edit quote" } : null,
      send: ctx.canQuote && agreement.status === "draft" ? { attrs: { "data-agreement-act": "quote-send", "data-agreement": agreement.id, "data-org": org } } : null,
      preview: { attrs: { "data-dlg": "dlgQPrev" } },
      convert: convertible ? { href: agreementTabHref("editor", agreement.id), dialog: "dlgQConv" } : { href: "#", blocked: convertBlocked ?? "Send the quote first" },
    },
  };
  const edit: QuoteEditDialogData | null = canEditQuote
    ? {
        organizationId: org,
        agreementId: agreement.id,
        currency,
        fields: {
          scope: ver.scope_summary,
          services: ver.services ?? "",
          exclusions: ver.exclusions ?? "",
          deliverables: ver.deliverables ?? "",
          feeStructure: ver.fee_structure ?? "",
          refund: ver.refund_policy ?? "",
          expiry: agreement.quote_expires_on && agreement.quote_expires_on >= ctx.today ? agreement.quote_expires_on : ctx.today,
          government: ver.government_fee_note ?? "",
        },
        today: ctx.today,
        lines: lineRows.map((row) => ({
          category: row.category,
          description: row.description,
          amount: amountInput(row.amount_cents),
          taxRate: bpsToPercent(row.tax_rate_bps),
          sourceNote: row.source_note ?? "",
        })),
        instalments: instalmentRows.map((row) => ({ label: row.label, amount: amountInput(row.amount_cents), paidAs: row.paid_as })),
        revises: Boolean(ver.locked_at),
        sample: Boolean(matter.data?.is_sample),
      }
    : null;
  const preview: QuotePreviewDialogData = {
    firmName: firm,
    title: agreement.title,
    status,
    facts: [
      { term: "Scope", value: ver.scope_summary },
      { term: "Services", value: textParts(ver.services, "Not listed").join(" · ") },
      { term: "Not included", value: ver.exclusions ?? "Nothing stated" },
      { term: "Deliverables", value: textParts(ver.deliverables, "Not listed").join(" · ") },
      { term: "Fee structure", value: ver.fee_structure ?? "Not stated" },
      { term: "Valid until", value: expiry },
      { term: "Professional fee", value: `${currency} ${amountMajor(totals.feeCents, currency)}` },
    ],
    lines: lineViews,
    total: { label: `Total to ${firm}`, amount: amountMajor(totals.firmCents, currency) },
    currency,
    instalments: instalmentViews,
    government: governmentCopy,
    refund,
    accept: "The client accepts the quote in their portal. Accepting is not signing: the service agreement is signed separately.",
  };
  const convert: QuoteConvertDialogData | null = convertible
    ? {
        organizationId: org,
        agreementId: agreement.id,
        templates: serviceTemplates.map((row) => ({ value: row.id, label: `${row.name} · v${row.version}` })),
        blocked: null,
      }
    : null;
  return { page, edit, preview, convert };
}

/** The Designer's New quote dialog, live: open matters with an applicant and the approved quote templates. */
export function newQuoteDialogData(
  staff: SheetStaff,
  matters: { value: string; left: string }[],
  ctx: AgreementsContext,
): NewQuoteDialogData {
  const quoteTemplates = ctx.templates.filter((row) => row.status === "approved" && row.kind === "quote");
  return {
    organizationId: staff.organizationId,
    matters: matters.filter((row) => row.value).map((row) => ({ value: row.value, label: row.left })),
    templates: quoteTemplates.map((row) => ({ value: row.id, label: `Program template · ${row.name} v${row.version}` })),
    blocked: !ctx.canQuote
      ? { title: "Licensed consultant or firm owner only", copy: "Only a licensed consultant or the firm owner builds and sends quotes." }
      : matters.some((row) => row.value)
        ? null
        : { title: "No matter to quote on", copy: "A quote is made on a matter with an applicant. Open the client’s matter first; a lead gets a quote once it is converted." },
    sampleMode: staff.sampleMode,
  };
}

export type EditorViewLoad = {
  page: EditorViewData;
  clauses: ClauseDialogData[];
  voidDialog: { organizationId: string; envelopeId: string; who: string } | null;
};

/** One agreement's clauses and signing panel (the Designer's Agreement editor tab). */
export async function loadEditorView(supabase: Client, staff: SheetStaff, agreementId: string, ctx: AgreementsContext): Promise<EditorViewLoad | null> {
  const org = staff.organizationId;
  const found = await supabase
    .from("agreements")
    .select("id, matter_id, kind, title, status, template_id, current_version_id, created_at, accepted_at")
    .eq("organization_id", org)
    .eq("id", agreementId)
    .maybeSingle();
  const agreement = found.data;
  if (!agreement || agreement.kind === "quote" || !agreement.current_version_id) return null;
  const [version, clauses, template, envelopes, consentSetting] = await Promise.all([
    supabase
      .from("agreement_versions")
      .select("id, version_number, content_sha256, locked_at, body, comparison_note")
      .eq("organization_id", org)
      .eq("id", agreement.current_version_id)
      .maybeSingle(),
    supabase.from("agreement_clauses").select("id, position, title, body, mandatory, source").eq("organization_id", org).eq("agreement_version_id", agreement.current_version_id).order("position"),
    agreement.template_id ? supabase.from("agreement_templates").select("id, name, version, approved_at").eq("organization_id", org).eq("id", agreement.template_id).maybeSingle() : null,
    supabase
      .from("signature_envelopes")
      .select("id, status, sent_at, expires_at, completed_at, voided_at, content_sha256")
      .eq("organization_id", org)
      .eq("agreement_id", agreement.id)
      .order("sent_at", { ascending: false })
      .limit(1),
    supabase.from("product_settings").select("value").eq("key", "agreements.esign_consent").maybeSingle(),
  ]);
  const ver = version.data;
  if (!ver) return null;
  const envelope = envelopes.data?.[0] ?? null;
  const signers = envelope
    ? (
        await supabase
          .from("envelope_signers")
          .select("id, signing_order, display_name, status, signed_at")
          .eq("organization_id", org)
          .eq("envelope_id", envelope.id)
          .order("signing_order")
      ).data ?? []
    : [];
  const consent = esignConsent(consentSetting.data?.value);
  const client = ctx.clientOf(agreement.matter_id);
  const executed = agreement.status === "completed" || agreement.status === "accepted";
  const waiting = Boolean(envelope && WAITING.has(envelope.status));
  const signedCount = signers.filter((row) => row.status === "signed").length;
  const tpl = template?.data ?? null;

  const intro = executed
    ? `Executed${envelope?.completed_at ? ` on ${firmLongDay(envelope.completed_at, staff.timezone)}` : ""}. The executed original can’t be edited; send an amendment for any change.`
    : tpl
      ? `Generated from template ${tpl.name} v${tpl.version}${tpl.approved_at ? ` (approved ${firmLongDay(tpl.approved_at, staff.timezone)})` : ""}. Mandatory clauses are owned by your professional reviewer and can’t be edited here.`
      : "Written without a template. Mandatory clauses are owned by your professional reviewer and can’t be edited here.";

  const clauseRows = clauses.data ?? [];
  const editable = ctx.canEdit && !executed;
  const clauseViews: EditorClause[] = clauseRows.length
    ? clauseRows.map((row) => ({
        key: row.id,
        num: String(row.position),
        title: row.title,
        summary: [clauseSummary(row.body)],
        mandatory: row.mandatory,
        dialog: editable && !row.mandatory ? `dlgClause-${row.position}` : undefined,
        locked: !editable && !row.mandatory ? (executed ? ["Executed", "can’t be edited"] : ["Locked", "your role can’t edit"]) : null,
      }))
    : [
        {
          num: "1",
          title: "Agreement text",
          summary: ["This version was made before the clause editor; its text is one piece and can’t be edited here"],
          mandatory: false,
          locked: ["Locked", "whole text"],
        },
      ];
  const dialogs: ClauseDialogData[] = editable
    ? clauseRows
        .filter((row) => !row.mandatory)
        .map((row) => ({
          organizationId: org,
          agreementId: agreement.id,
          clauseId: row.id,
          dialogId: `dlgClause-${row.position}`,
          num: String(row.position),
          title: row.title,
          body: row.body,
          revises: Boolean(ver.locked_at) || waiting,
          signedCount,
        }))
    : [];

  const stateWords =
    agreement.status === "draft"
      ? ver.locked_at
        ? "new draft after a sent version"
        : `draft${ver.comparison_note ? ", revised" : ""}`
      : versionStateWords(agreement.status);
  const versionParts: DdPart[] = [{ text: `${agreement.title} v${ver.version_number}` }, { text: stateWords }];
  const hash = shortHash(envelope?.content_sha256 ?? ver.content_sha256);
  versionParts.push(hash ? { text: "hash ", num: hash } : { text: "hash set when it is sent" });
  const current = signers.find((row) => row.status === "current");
  const signerParts: DdPart[] = signers.length
    ? signers.map((row) => ({ text: `${row.signing_order}. ${row.display_name}` }))
    : [{ text: "Not sent for signature yet: the applicant signs first, then the sponsor, then the consultant for the firm" }];
  const sentParts: DdPart[] = envelope
    ? [
        { text: "", num: sentWhen(envelope.sent_at, staff.timezone) },
        {
          text:
            envelope.status === "completed"
              ? "signed by everyone"
              : waiting
                ? current
                  ? `waiting for ${current.display_name}`
                  : "waiting"
                : versionStateWords(envelope.status),
        },
      ]
    : [{ text: "Not sent yet" }];
  const expiresParts: DdPart[] = envelope && waiting ? [{ text: "", num: firmLongDay(envelope.expires_at, staff.timezone) }] : [{ text: envelope ? "—" : "Set when it is sent" }];

  const page: EditorViewData = {
    title: kindLabel(agreement.kind),
    client,
    intro,
    clauses: clauseViews,
    signing: {
      facts: [
        { term: "Version", parts: versionParts },
        { term: "Signers, in order", parts: signerParts },
        { term: "Signer check", parts: [{ text: "Signed-in portal account; staff confirm their authenticator" }] },
        { term: "E-sign consent", parts: [{ text: `Asked before signing (${consent.version})` }] },
        { term: "Sent", parts: sentParts },
        { term: "Expires", parts: expiresParts },
      ],
      reminder: { attrs: {}, disabled: "No approved email design for a signing reminder yet. The signer sees the agreement in their portal." },
      void: waiting && ctx.canEdit,
    },
  };
  return {
    page,
    clauses: dialogs,
    voidDialog: envelope && waiting && ctx.canEdit ? { organizationId: org, envelopeId: envelope.id, who: current?.display_name ?? client } : null,
  };
}

const EVENT_WORDS: Record<string, string> = {
  sent: "Sent",
  signed: "signed",
  declined: "declined",
  voided: "Envelope voided",
  expired: "Envelope expired",
  completed: "Everyone signed",
  superseded: "Replaced by a new version",
};

/** One agreement's versions side by side (the Designer's Compare versions tab). */
export async function loadCompareView(supabase: Client, staff: SheetStaff, agreementId: string, ctx: AgreementsContext): Promise<{ page: CompareViewData } | null> {
  const org = staff.organizationId;
  const found = await supabase
    .from("agreements")
    .select("id, matter_id, kind, title, status, current_version_id, accepted_at")
    .eq("organization_id", org)
    .eq("id", agreementId)
    .maybeSingle();
  const agreement = found.data;
  if (!agreement) return null;
  const [versions, envelopes] = await Promise.all([
    supabase
      .from("agreement_versions")
      .select("id, version_number, body, fee_cents, currency, comparison_note, locked_at, created_at")
      .eq("organization_id", org)
      .eq("agreement_id", agreement.id)
      .order("version_number"),
    supabase
      .from("signature_envelopes")
      .select("id, version_id, status, sent_at, completed_at, voided_at")
      .eq("organization_id", org)
      .eq("agreement_id", agreement.id)
      .order("sent_at"),
  ]);
  const versionRows = versions.data ?? [];
  if (!versionRows.length) return null;
  const envelopeRows = envelopes.data ?? [];
  const envelopeIds = envelopeRows.map((row) => row.id);
  const versionIds = versionRows.map((row) => row.id);
  const [clauses, signers, events] = await Promise.all([
    supabase.from("agreement_clauses").select("agreement_version_id, position, title, body").eq("organization_id", org).in("agreement_version_id", versionIds).order("position"),
    envelopeIds.length ? supabase.from("envelope_signers").select("envelope_id, display_name, status, signed_at").eq("organization_id", org).in("envelope_id", envelopeIds).order("signing_order") : null,
    envelopeIds.length ? supabase.from("signature_events").select("envelope_id, signer_id, kind, occurred_at").eq("organization_id", org).in("envelope_id", envelopeIds).order("occurred_at") : null,
  ]);
  const day = (iso: string) => dayMonth(isoDateInTimeZone(new Date(iso), staff.timezone));
  const first = (name: string) => name.trim().split(/\s+/)[0] || name;
  const clausesOf = (versionId: string) => (clauses.data ?? []).filter((row) => row.agreement_version_id === versionId).map((row) => ({ position: row.position, title: row.title, body: row.body }));
  const envelopeOf = (versionId: string) => [...envelopeRows].reverse().find((row) => row.version_id === versionId) ?? null;

  const stateOf = (version: (typeof versionRows)[number]): string => {
    const current = version.id === agreement.current_version_id;
    if (agreement.kind === "quote") {
      if (current) return agreement.status;
      return version.locked_at ? "superseded" : "draft";
    }
    const envelope = envelopeOf(version.id);
    if (envelope) return envelope.status;
    if (current) return agreement.status;
    return "superseded";
  };

  const history: CompareViewData["history"] = versionRows.map((version) => {
    const envelope = envelopeOf(version.id);
    const state = stateOf(version);
    const signed = envelope
      ? (signers?.data ?? [])
          .filter((row) => row.envelope_id === envelope.id && row.status === "signed" && row.signed_at)
          .map((row) => `${first(row.display_name)}, ${day(row.signed_at as string)}`)
      : [];
    const parts: string[] = [];
    if (version.comparison_note) parts.push(version.comparison_note);
    if (agreement.kind === "quote") {
      if (version.locked_at) parts.push(`Issued ${day(version.locked_at)}`);
      if (version.id === agreement.current_version_id && agreement.status === "accepted" && agreement.accepted_at) parts.push(`accepted ${day(agreement.accepted_at)}`);
    } else if (envelope) {
      for (const event of (events?.data ?? []).filter((row) => row.envelope_id === envelope.id)) {
        const label = EVENT_WORDS[event.kind];
        if (!label) continue;
        if (event.kind === "signed" || event.kind === "declined") continue;
        parts.push(`${label} ${day(event.occurred_at)}`);
      }
    }
    if (!parts.length) parts.push(version.locked_at ? `Locked ${day(version.locked_at)}` : `Draft since ${day(version.created_at)}`);
    return { key: version.id, version: `v${version.version_number}`, state: versionStateBadge(state), signed: signed.length ? signed.join("; ") : "—", event: parts };
  });

  const client = ctx.clientOf(agreement.matter_id);
  const currentVersion = versionRows[versionRows.length - 1];
  const previousVersion = versionRows.length > 1 ? versionRows[versionRows.length - 2] : null;
  let sections: CompareViewData["sections"];
  let intro: string;
  if (!previousVersion) {
    const badge: MatterBadge = versionBadge(currentVersion.version_number, stateOf(currentVersion));
    sections = [{ key: "only", label: "Whole text", name: "One version", badges: [badge], paragraphs: [], unchanged: "This agreement has one version so far; there is nothing to compare yet. Editing a clause after it is sent makes a new version." }];
    intro = `${agreement.title} has one version. A changed fee or clause after it is sent makes v2, and the two show here side by side.`;
  } else {
    const badges = [versionBadge(previousVersion.version_number, stateOf(previousVersion)), versionBadge(currentVersion.version_number, stateOf(currentVersion))];
    sections = compareSections(
      { clauses: clausesOf(previousVersion.id), body: previousVersion.body },
      { clauses: clausesOf(currentVersion.id), body: currentVersion.body },
      badges,
    );
    const feeChanged = String(previousVersion.fee_cents ?? "") !== String(currentVersion.fee_cents ?? "");
    const previousEnvelope = envelopeOf(previousVersion.id);
    const previousSigned = previousEnvelope ? (signers?.data ?? []).filter((row) => row.envelope_id === previousEnvelope.id && row.status === "signed").length : 0;
    const why = currentVersion.comparison_note ? ` ${currentVersion.comparison_note}.` : "";
    const fee = feeChanged
      ? ` The professional fee changed from ${previousVersion.currency} ${amountMajor(previousVersion.fee_cents ?? 0, previousVersion.currency)} to ${currentVersion.currency} ${amountMajor(currentVersion.fee_cents ?? 0, currentVersion.currency)}${previousSigned ? ` while ${previousSigned === 1 ? "one person" : `${previousSigned} people`} had signed` : ""}.`
      : "";
    const next = stateOf(currentVersion) === "draft" ? ` v${currentVersion.version_number} is a draft${agreement.kind === "quote" ? "; send it so the client can accept it" : "; send it for fresh signatures from everyone"}.` : "";
    intro = `${agreement.title} v${previousVersion.version_number} is ${versionStateWords(stateOf(previousVersion))}; v${currentVersion.version_number} is ${versionStateWords(stateOf(currentVersion))}.${why}${fee}${next}`;
  }
  return { page: { client, intro, sections, history } };
}

/** A tab opened without an agreement: the firm's agreements it applies to, newest first. */
export function pickList(
  tab: "quote" | "editor" | "compare",
  rows: { id: string; matter_id: string; kind: string; status: string; title: string }[],
  versionNumber: (agreementId: string) => number | undefined,
  ctx: AgreementsContext,
): AgreementsPickData {
  const list = tab === "quote" ? rows.filter((row) => row.kind === "quote") : tab === "editor" ? rows.filter((row) => row.kind !== "quote") : rows;
  const words = {
    quote: {
      title: "Quote builder",
      intro: "Quotes for clients, before a service agreement. An accepted quote is not a signed agreement. Choose a quote, or make one.",
      empty: { title: "No quotes yet", copy: "A quote proposes a defined service with its fees, by category, and how it is paid. The client accepts it in their portal." },
      action: ctx.canQuote ? { label: "New quote", dialog: "dlgNewQ" } : null,
    },
    editor: {
      title: "Agreement editor",
      intro: "An agreement’s clauses come from an approved template. Mandatory clauses stay as the reviewer approved them; the others can be edited until the agreement is executed. Choose an agreement.",
      empty: { title: "No agreements yet", copy: "Create one from an approved template in All agreements, then edit its clauses here before sending it." },
      action: { label: "All agreements", href: "/sheet/agreements" },
    },
    compare: {
      title: "Compare versions",
      intro: "Side-by-side versions of one agreement, with what changed between them. Choose an agreement.",
      empty: { title: "No agreements yet", copy: "Once an agreement has a second version, its changes show here word by word." },
      action: { label: "All agreements", href: "/sheet/agreements" },
    },
  }[tab];
  return {
    title: words.title,
    intro: words.intro,
    rows: list.map((row) => {
      const number = versionNumber(row.id);
      return {
        key: row.id,
        href: agreementTabHref(tab, row.id),
        title: row.title,
        note: [ctx.clientOf(row.matter_id), ctx.referenceOf(row.matter_id), number ? `v${number}` : kindLabel(row.kind)],
        state: agreementBadge(row.status, row.kind),
      };
    }),
    empty: { ...words.empty, action: words.action },
  };
}
