import { asServiceRole, type TestDb } from "./postgres";

export type CaptureInput = {
  orgId: string;
  url: string;
  snapshot: { sha256: string; retrieved_at?: string; final_url?: string; http_status?: number; modified_on?: string | null; current_to?: string | null };
  title?: string | null;
  /** Defaults to the signed-in user of the current session. */
  actor?: string;
};

/**
 * Stores a page capture the way the app server does (public.service_store_page_capture as the
 * service role) and returns the p_snapshot payload the claim/requirement RPCs accept. The current
 * session (user, claims, firm and role) is restored afterwards.
 */
export async function serverCapture(db: TestDb, input: CaptureInput): Promise<{ snapshot_id: string }> {
  const saved = (
    await db.query<{ claims: string | null; sub: string | null; org: string | null; role: string }>(
      `select current_setting('request.jwt.claims', true) as claims, current_setting('request.jwt.claim.sub', true) as sub,
              current_setting('app.organization_id', true) as org, current_user::text as role`,
    )
  ).rows[0];
  const actor = input.actor ?? saved.sub ?? "";
  await asServiceRole(db);
  try {
    const row = await db.query<{ id: string }>(`select public.service_store_page_capture($1, $2, $3, $4, $5::jsonb) as id`, [
      input.orgId,
      actor || null,
      input.url,
      input.title ?? null,
      JSON.stringify({
        retrieved_at: new Date().toISOString(),
        final_url: input.url.split("#")[0],
        http_status: 200,
        ...input.snapshot,
      }),
    ]);
    return { snapshot_id: row.rows[0].id };
  } finally {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [saved.sub ?? ""]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [saved.claims ?? ""]);
    await db.query(`select set_config('app.organization_id', $1, false)`, [saved.org ?? ""]);
    if (["authenticated", "anon", "service_role"].includes(saved.role)) await db.exec(`set role ${saved.role}`);
  }
}
