import "server-only";

import { cookies } from "next/headers";
import { totpQr } from "@/lib/auth/totp-qr";

/**
 * An authenticator set up on /mfa but not yet confirmed with a code. Only the link is kept;
 * the QR image is drawn from it (see totp-qr.ts). Browsers drop cookies over 4 KB.
 */
export type PendingTotp = { factorId: string; secret: string; uri: string };

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
      typeof value.uri === "string" &&
      value.uri.startsWith("otpauth://totp/") &&
      value.uri.length <= 512
    ) {
      return { factorId: value.factorId, secret: value.secret, uri: value.uri };
    }
  } catch {
    return null;
  }
  return null;
}

/** What the setup screen shows: the pending setup plus its QR image. */
export type TotpSetup = { factorId: string; secret: string; qr: string };

export async function withQr(pending: PendingTotp): Promise<TotpSetup> {
  return { factorId: pending.factorId, secret: pending.secret, qr: await totpQr(pending.uri) };
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
