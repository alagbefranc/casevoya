import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { PortalViewer } from "@/modules/portal/load";

export type AgreementSignerView = {
  id: string;
  name: string;
  role: string;
  status: string;
  order: number;
  signedAt: string | null;
};

export type PortalAgreement = {
  id: string;
  matterId: string;
  title: string;
  kind: string;
  status: string;
  scope: string;
  exclusions: string | null;
  refundPolicy: string | null;
  comparison: string | null;
  feeCents: number | null;
  currency: string;
  governmentFeeNote: string | null;
  contentSha: string | null;
  envelopeId: string | null;
  canSign: boolean;
  canAccept: boolean;
  needsStepUp: boolean;
  signers: AgreementSignerView[];
  /** A quote's own fields: services, deliverables, fee structure, expiry, priced lines and instalments (cents). */
  quote: QuoteView | null;
};

export type QuoteLine = { id: string; category: string; description: string; amountCents: number; sourceNote: string | null; enteredOn: string | null };
export type QuoteInstalment = { id: string; label: string; amountCents: number; paidAs: string };
export type QuoteView = {
  services: string | null;
  deliverables: string | null;
  feeStructure: string | null;
  expiresOn: string | null;
  acceptedAt: string | null;
  lines: QuoteLine[];
  instalments: QuoteInstalment[];
  /** Every line but government fees, in cents. */
  totalCents: number;
};

export type PortalAgreements = {
  open: PortalAgreement[];
  done: PortalAgreement[];
  consentText: string;
};

type VersionRow = {
  id: string;
  agreement_id: string;
  scope_summary: string;
  exclusions: string | null;
  refund_policy: string | null;
  comparison_note: string | null;
  fee_cents: number | null;
  currency: string;
  government_fee_note: string | null;
  content_sha256: string | null;
  services: string | null;
  deliverables: string | null;
  fee_structure: string | null;
};

type EnvelopeRow = {
  id: string;
  agreement_id: string;
  version_id: string;
  status: string;
  sent_at: string;
};

type SignerRow = {
  id: string;
  envelope_id: string;
  signing_order: number;
  role: string;
  person_id: string | null;
  membership_id: string | null;
  display_name: string;
  status: string;
  signed_at: string | null;
};

/** Agreements the signed-in person may see. RLS hides every other firm's rows. */
export async function loadPortalAgreements(viewer: PortalViewer): Promise<PortalAgreements> {
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const [{ data: agreements }, { data: versions }, { data: envelopes }, { data: signers }, { data: memberships }, { data: consent }, { data: quoteLines }, { data: quoteInstalments }] =
    await Promise.all([
      supabase.from("agreements").select("id, matter_id, title, kind, status, current_version_id, quote_expires_on, accepted_at").limit(40),
      supabase
        .from("agreement_versions")
        .select("id, agreement_id, scope_summary, exclusions, refund_policy, comparison_note, fee_cents, currency, government_fee_note, content_sha256, services, deliverables, fee_structure")
        .limit(80),
      supabase.from("signature_envelopes").select("id, agreement_id, version_id, status, sent_at").order("sent_at", { ascending: false }).limit(80),
      supabase
        .from("envelope_signers")
        .select("id, envelope_id, signing_order, role, person_id, membership_id, display_name, status, signed_at")
        .order("signing_order", { ascending: true })
        .limit(200),
      userId
        ? supabase.from("memberships").select("id").eq("user_id", userId).eq("status", "active").limit(10)
        : Promise.resolve({ data: [] as { id: string }[] }),
      supabase.from("product_settings").select("value").eq("key", "agreements.esign_consent").maybeSingle(),
      // A quote's priced lines and instalments (RLS: the quote's matter parties and the firm's staff).
      supabase.from("quote_lines").select("id, agreement_version_id, position, category, description, amount_cents, source_note, entered_on").order("position").limit(400),
      supabase.from("quote_instalments").select("id, agreement_version_id, position, label, amount_cents, paid_as").order("position").limit(200),
    ]);

  const versionById = new Map((versions ?? []).map((row) => [row.id, row as VersionRow]));
  const envelopesByAgreement = new Map<string, EnvelopeRow[]>();
  for (const row of (envelopes ?? []) as EnvelopeRow[]) {
    const list = envelopesByAgreement.get(row.agreement_id) ?? [];
    list.push(row);
    envelopesByAgreement.set(row.agreement_id, list);
  }
  const signersByEnvelope = new Map<string, SignerRow[]>();
  for (const row of (signers ?? []) as SignerRow[]) {
    const list = signersByEnvelope.get(row.envelope_id) ?? [];
    list.push(row);
    signersByEnvelope.set(row.envelope_id, list);
  }
  const mine = new Set((memberships ?? []).map((row) => row.id));
  const personId = viewer.person?.id ?? null;

  const cards: PortalAgreement[] = [];
  for (const agreement of agreements ?? []) {
    const version = agreement.current_version_id ? versionById.get(agreement.current_version_id) : undefined;
    const envelope = (envelopesByAgreement.get(agreement.id) ?? [])[0] ?? null;
    const rows = envelope ? signersByEnvelope.get(envelope.id) ?? [] : [];
    const current = rows.find((row) => row.status === "current");
    const canSign = Boolean(
      current && ((personId && current.person_id === personId) || (current.membership_id && mine.has(current.membership_id))),
    );
    const lines = version ? (quoteLines ?? []).filter((row) => row.agreement_version_id === version.id) : [];
    const instalments = version ? (quoteInstalments ?? []).filter((row) => row.agreement_version_id === version.id) : [];
    const quote: QuoteView | null =
      agreement.kind === "quote"
        ? {
            services: version?.services ?? null,
            deliverables: version?.deliverables ?? null,
            feeStructure: version?.fee_structure ?? null,
            expiresOn: agreement.quote_expires_on ?? null,
            acceptedAt: agreement.accepted_at ?? null,
            lines: lines.map((row) => ({
              id: row.id,
              category: row.category,
              description: row.description,
              amountCents: Math.trunc(Number(row.amount_cents)) || 0,
              sourceNote: row.source_note,
              enteredOn: row.entered_on,
            })),
            instalments: instalments.map((row) => ({ id: row.id, label: row.label, amountCents: Math.trunc(Number(row.amount_cents)) || 0, paidAs: row.paid_as })),
            totalCents: lines.filter((row) => row.category !== "government_fee").reduce((sum, row) => sum + (Math.trunc(Number(row.amount_cents)) || 0), 0),
          }
        : null;
    cards.push({
      id: agreement.id,
      matterId: agreement.matter_id,
      title: agreement.title,
      kind: agreement.kind,
      status: agreement.status,
      scope: version?.scope_summary ?? "",
      exclusions: version?.exclusions ?? null,
      refundPolicy: version?.refund_policy ?? null,
      comparison: version?.comparison_note ?? null,
      feeCents: version?.fee_cents ?? null,
      currency: version?.currency ?? "CAD",
      governmentFeeNote: version?.government_fee_note ?? null,
      contentSha: version?.content_sha256 ?? null,
      envelopeId: envelope?.id ?? null,
      canSign,
      canAccept: agreement.kind === "quote" && agreement.status === "sent" && Boolean(personId),
      needsStepUp: Boolean(canSign && current?.membership_id),
      signers: rows.map((row) => ({
        id: row.id,
        name: row.display_name,
        role: row.role,
        status: row.status,
        order: row.signing_order,
        signedAt: row.signed_at,
      })),
      quote,
    });
  }

  const open = cards.filter((card) => ["draft", "sent", "partially_signed"].includes(card.status));
  const done = cards.filter((card) => !open.includes(card));
  const configured = consent?.value;
  const consentText =
    configured && typeof configured === "object" && !Array.isArray(configured) && typeof configured.text === "string"
      ? configured.text
      : "I agree to sign this document electronically. This electronic signature is my agreement to the locked text and its SHA-256 hash.";
  return { open, done, consentText };
}
