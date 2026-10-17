import "server-only";

import { cookies } from "next/headers";

/** An authenticator set up on /mfa but not yet confirmed with a code. */
export type PendingTotp = { factorId: string; secret: string; qr: string };

const NAME = "cv_mfa_pending";
/** Long enough to scan and type a code; short enough that a stale setup is not reused. */
const MAX_AGE_SECONDS = 15 * 60;

function parse(raw: string | undefined): PendingTotp | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingTotp>;
    if (
      typeof value.factorId === "string" &&
      /^[0-9a-f-]{36}$/i.test(value.factorId) &&
      typeof value.secret === "string" &&
      /^[A-Z2-7]+=*$/.test(value.secret) &&
      typeof value.qr === "string" &&
      value.qr.startsWith("data:image/")
    ) {
      return { factorId: value.factorId, secret: value.secret, qr: value.qr };
    }
  } catch {
    return null;
  }
  return null;
}

/** Readable from a Server Component. The caller still checks the factor exists and is unverified. */
export async function readPendingTotp(): Promise<PendingTotp | null> {
  return parse((await cookies()).get(NAME)?.value);
}

/** Server Functions and Route Handlers only. */
export async function writePendingTotp(value: PendingTotp): Promise<void> {
  (await cookies()).set(NAME, JSON.stringify(value), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Server Functions and Route Handlers only. */
export async function clearPendingTotp(): Promise<void> {
  (await cookies()).delete(NAME);
}
