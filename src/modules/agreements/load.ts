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
  const [{ data: agreements }, { data: versions }, { data: envelopes }, { data: signers }, { data: memberships }, { data: consent }] =
    await Promise.all([
      supabase.from("agreements").select("id, matter_id, title, kind, status, current_version_id").limit(40),
      supabase
        .from("agreement_versions")
        .select("id, agreement_id, scope_summary, exclusions, refund_policy, comparison_note, fee_cents, currency, government_fee_note, content_sha256")
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
