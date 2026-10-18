/**
 * What the sealed PDF is rendered from: the JSON returned by public.agreement_seal_source
 * (service role only). Every field comes from rows that no longer change once the envelope is
 * completed (the locked version, the signed signers, append-only events).
 */

export type SealSigner = {
  signingOrder: number;
  role: string;
  displayName: string;
  status: string;
  signedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  consentVersion: string | null;
  consentText: string | null;
};

export type SealEvent = {
  kind: string;
  occurredAt: string;
  signingOrder: number | null;
  ip: string | null;
  consentVersion: string | null;
};

export type SealSource = {
  organization: {
    id: string;
    displayName: string;
    legalName: string;
    timezone: string;
    logoLocator: string | null;
    accent: string | null;
  };
  matter: { reference: string | null; title: string | null };
  agreement: { id: string; kind: string; title: string };
  version: {
    versionNumber: number;
    canonicalBody: string;
    scopeSummary: string;
    exclusions: string | null;
    refundPolicy: string | null;
    feeCents: string | null;
    currency: string;
    governmentFeeNote: string | null;
    comparisonNote: string | null;
    lockedAt: string | null;
  };
  envelope: {
    id: string;
    status: string;
    contentSha256: string;
    sentAt: string;
    completedAt: string | null;
    sealed: boolean;
  };
  signers: SealSigner[];
  events: SealEvent[];
};

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}
function str(value: unknown): string | null {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : null;
}
function req(value: unknown, field: string): string {
  const text = str(value);
  if (text == null) throw new Error(`seal source is missing ${field}`);
  return text;
}

/** Reads and checks the seal source. Throws when a required field is missing. */
export function parseSealSource(value: unknown): SealSource {
  const root = obj(value);
  const org = obj(root.organization);
  const matter = obj(root.matter);
  const agreement = obj(root.agreement);
  const version = obj(root.version);
  const envelope = obj(root.envelope);
  const contentSha = req(envelope.content_sha256, "envelope.content_sha256");
  if (!/^[0-9a-f]{64}$/.test(contentSha)) throw new Error("seal source content hash is malformed");
  return {
    organization: {
      id: req(org.id, "organization.id"),
      displayName: req(org.display_name, "organization.display_name"),
      legalName: str(org.legal_name) ?? req(org.display_name, "organization.display_name"),
      timezone: str(org.timezone) ?? "UTC",
      logoLocator: str(org.logo_locator),
      accent: str(org.accent),
    },
    matter: { reference: str(matter.reference), title: str(matter.title) },
    agreement: {
      id: req(agreement.id, "agreement.id"),
      kind: req(agreement.kind, "agreement.kind"),
      title: req(agreement.title, "agreement.title"),
    },
    version: {
      versionNumber: Number(version.version_number ?? 1),
      canonicalBody: req(version.canonical_body, "version.canonical_body"),
      scopeSummary: str(version.scope_summary) ?? "",
      exclusions: str(version.exclusions),
      refundPolicy: str(version.refund_policy),
      feeCents: str(version.fee_cents),
      currency: str(version.currency) ?? "CAD",
      governmentFeeNote: str(version.government_fee_note),
      comparisonNote: str(version.comparison_note),
      lockedAt: str(version.locked_at),
    },
    envelope: {
      id: req(envelope.id, "envelope.id"),
      status: req(envelope.status, "envelope.status"),
      contentSha256: contentSha,
      sentAt: req(envelope.sent_at, "envelope.sent_at"),
      completedAt: str(envelope.completed_at),
      sealed: envelope.sealed === true,
    },
    signers: (Array.isArray(root.signers) ? root.signers : []).map((item) => {
      const row = obj(item);
      return {
        signingOrder: Number(row.signing_order ?? 0),
        role: str(row.role) ?? "client",
        displayName: str(row.display_name) ?? "Signer",
        status: str(row.status) ?? "waiting",
        signedAt: str(row.signed_at),
        ip: str(row.ip),
        userAgent: str(row.user_agent),
        consentVersion: str(row.consent_version),
        consentText: str(row.consent_text),
      };
    }),
    events: (Array.isArray(root.events) ? root.events : []).map((item) => {
      const row = obj(item);
      return {
        kind: str(row.kind) ?? "event",
        occurredAt: req(row.occurred_at, "event.occurred_at"),
        signingOrder: row.signing_order == null ? null : Number(row.signing_order),
        ip: str(row.ip),
        consentVersion: str(row.consent_version),
      };
    }).sort(byEventOrder),
  };
}

/** Where events share a timestamp (the last signature and completion do), sent comes first, then signatures by signing order, then completion. */
const EVENT_RANK: Record<string, number> = { sent: 0, completed: 2 };

function byEventOrder(a: SealEvent, b: SealEvent): number {
  const time = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
  if (time !== 0) return time;
  const rank = (EVENT_RANK[a.kind] ?? 1) - (EVENT_RANK[b.kind] ?? 1);
  if (rank !== 0) return rank;
  return (a.signingOrder ?? 0) - (b.signingOrder ?? 0);
}

/**
 * The agreement terms on their own. The canonical text (app.agreement_canonical) is the kind,
 * title, scope, exclusions, refund policy, fee in minor units, currency, government fee note,
 * comparison note and terms joined by line breaks. When the stored fields rebuild that prefix
 * exactly, the rest is the terms; otherwise the whole canonical text is shown as the terms.
 */
export function agreementTerms(source: SealSource): { terms: string; exact: boolean } {
  const { version, agreement } = source;
  const prefix = [
    agreement.kind,
    agreement.title,
    version.scopeSummary,
    version.exclusions ?? "",
    version.refundPolicy ?? "",
    version.feeCents ?? "",
    version.currency,
    version.governmentFeeNote ?? "",
    version.comparisonNote ?? "",
  ].join("\n") + "\n";
  if (version.canonicalBody.startsWith(prefix)) {
    return { terms: version.canonicalBody.slice(prefix.length), exact: true };
  }
  return { terms: version.canonicalBody, exact: false };
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
