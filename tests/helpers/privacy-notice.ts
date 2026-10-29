import { createHash } from "node:crypto";
import type { TestDb } from "./postgres";

/**
 * #263-A: a firm's public booking and enquiry pages need its published privacy notice. Fixtures
 * that publish a booking page give the firm one first. Run as maintenance (asMaintenance).
 */
export async function publishTestPrivacyNotice(db: TestDb, orgId: string, body = "Synthetic notice") {
  await db.query(
    `insert into public.portal_policy_documents (organization_id, kind, version_label, title, body, body_sha256)
     values ($1, 'privacy_notice', 'v1', 'Privacy notice', $2, $3)`,
    [orgId, body, createHash("sha256").update(body).digest("hex")],
  );
}
