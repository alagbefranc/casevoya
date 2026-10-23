"use server";

import { cookies } from "next/headers";
import { emailRuntimeConfig } from "@/lib/email/env";
import { createClient } from "@/lib/supabase/server";
import { clientEvidence } from "@/modules/agreements/evidence";
import { sealSigningCode } from "@/modules/email/invite-link-seal";
import { isBookingRef, signError } from "./agreement-sign-present";

/**
 * The consultation agreement signing flow behind a booking's private link (no login). Anyone
 * holding the link may ask for a code, but only the person who can read the attendee's email can
 * sign: the code is emailed to them, and a verified code hands this browser a session (an
 * httpOnly cookie scoped to the link) that signing requires. The database stores only hashes.
 */

const MAX_IMAGE_BYTES = 1_572_864;
const SESSION_SECONDS = 2 * 60 * 60;

const encoder = new TextEncoder();

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A uniform six-digit code. */
function sixDigits(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  for (;;) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    if (value < limit) return String(value % 1_000_000).padStart(6, "0");
  }
}

function sessionCookie(ref: string) {
  return { name: `cv_sign_${ref}`, path: `/consultation/${ref}` };
}

export type CodeAnswer =
  | { state: "sent"; emailMask: string | null }
  | { state: "wait"; seconds: number }
  | { state: "notices_off" | "limited" | "closed" | "unavailable" }
  | { error: string };

/** Emails a six-digit code to the booking's attendee. The code is sealed here; the database keeps its hash. */
export async function sendSigningCode(ref: string): Promise<CodeAnswer> {
  if (!isBookingRef(ref)) return { state: "unavailable" };
  const code = sixDigits();
  const codeId = crypto.randomUUID();
  const sealed = await sealSigningCode(emailRuntimeConfig().dispatchSecret, code, codeId);
  if (!sealed) return { error: "We couldn’t send a code right now. Try again in a minute." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_booking_agreement_code", {
    p_ref: ref,
    p_code_id: codeId,
    p_code_sha256: await sha256(code),
    p_sealed: sealed,
  });
  if (error) return { error: "We couldn’t send a code right now. Try again in a minute." };
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.state === "sent") return { state: "sent", emailMask: typeof row.email_mask === "string" ? row.email_mask : null };
  if (row.state === "wait") return { state: "wait", seconds: typeof row.seconds === "number" ? row.seconds : 30 };
  if (row.state === "notices_off" || row.state === "limited" || row.state === "closed") return { state: row.state };
  return { state: "unavailable" };
}

export type VerifyAnswer = { state: "ok" } | { state: "wrong"; left: number } | { state: "locked" | "expired" | "none" | "unavailable" } | { error: string };

/** Checks the code. On a match this browser gets the signing session. */
export async function verifySigningCode(ref: string, code: string): Promise<VerifyAnswer> {
  if (!isBookingRef(ref)) return { state: "unavailable" };
  if (!/^\d{6}$/.test(code)) return { error: "Enter all 6 digits." };
  const token = randomHex(32);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_booking_agreement_code", {
    p_ref: ref,
    p_code_sha256: await sha256(code),
    p_session_sha256: await sha256(token),
  });
  if (error) return { error: "That didn’t work. Try again in a moment." };
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.state === "ok") {
    const jar = await cookies();
    jar.set({ ...sessionCookie(ref), value: token, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: SESSION_SECONDS });
    return { state: "ok" };
  }
  if (row.state === "wrong") return { state: "wrong", left: typeof row.left === "number" ? row.left : 0 };
  if (row.state === "locked" || row.state === "expired" || row.state === "none") return { state: row.state };
  return { state: "unavailable" };
}

/**
 * Signs: the code session from this browser, the consent, the name, the hash of the text shown,
 * and a typed, drawn or uploaded signature (a PNG or JPEG file of at most 1.5 MB). The database
 * checks each again and records the IP and browser this server saw.
 */
export async function signBookingAgreement(form: FormData): Promise<{ ok: true; signedAt: string | null } | { error: string }> {
  const ref = String(form.get("ref") ?? "");
  const sha256Shown = String(form.get("sha256") ?? "");
  const kind = String(form.get("kind") ?? "");
  const name = String(form.get("name") ?? "").trim();
  if (!isBookingRef(ref) || !/^[0-9a-f]{64}$/.test(sha256Shown)) return { error: signError("not available") };
  if (kind !== "typed" && kind !== "drawn" && kind !== "uploaded") return { error: "Choose how to sign." };
  if (name.length < 2) return { error: signError("full name") };
  if (form.get("consent") !== "on") return { error: signError("consent is required") };
  let image: string | null = null;
  if (kind !== "typed") {
    const file = form.get("image");
    if (!(file instanceof Blob) || file.size === 0) return { error: kind === "drawn" ? "Draw your signature first." : "Choose a PNG or JPEG of your signature." };
    if (file.size > MAX_IMAGE_BYTES) return { error: "That image is over 1.5 MB. Choose a smaller PNG or JPEG." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpeg) return { error: "Choose a PNG or JPEG of your signature." };
    image = Buffer.from(bytes).toString("base64");
  }
  const jar = await cookies();
  const token = jar.get(sessionCookie(ref).name)?.value ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: signError("emailed code") };
  const supabase = await createClient();
  const evidence = await clientEvidence();
  const { data, error } = await supabase.rpc("sign_booking_agreement", {
    p_ref: ref,
    p_name: name.slice(0, 200),
    p_consent: true,
    p_sha256: sha256Shown,
    p_ip: evidence.ip,
    p_user_agent: evidence.userAgent,
    p_session_sha256: await sha256(token),
    p_signature_kind: kind,
    p_signature_image: image,
  });
  if (error) return { error: signError(error.message) };
  jar.delete(sessionCookie(ref));
  const row = (data ?? {}) as Record<string, unknown>;
  return { ok: true, signedAt: typeof row.signed_at === "string" ? row.signed_at : null };
}

/** The booker declines with a reason the firm sees. */
export async function declineBookingAgreement(ref: string, reason: string): Promise<{ ok: true } | { error: string }> {
  const text = reason.trim();
  if (!isBookingRef(ref)) return { error: signError("not available") };
  if (text.length < 1) return { error: "Say why you’re declining. The firm sees this." };
  if (text.length > 500) return { error: "Keep the reason under 500 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_booking_agreement", { p_ref: ref, p_reason: text });
  return error ? { error: signError(error.message) } : { ok: true };
}

export type SigningRequest = "wrong_recipient" | "code_help" | "link_requested" | "message";

/** "Not you?", "Can't get the email?", "Ask for a new link", "Message the firm": recorded for the firm. */
export async function noteSigningRequest(ref: string, kind: SigningRequest): Promise<{ ok: true } | { error: string }> {
  if (!isBookingRef(ref)) return { error: signError("not available") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("note_booking_agreement_request", { p_ref: ref, p_kind: kind });
  return error ? { error: "That didn’t go through. Try again in a moment." } : { ok: true };
}
