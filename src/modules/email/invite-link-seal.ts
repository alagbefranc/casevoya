/**
 * Sealed invitation links. The server action that receives a raw invitation token builds the
 * absolute accept link and seals it here; the database only ever stores the sealed form, and
 * the mail worker opens it with the same server secret. AES-256-GCM through Web Crypto (it runs
 * in the Cloudflare Worker), with the key derived by HKDF-SHA-256 from EMAIL_DISPATCH_SECRET.
 * The invitation id is the additional authenticated data, so a sealed link only opens for the
 * invitation it was made for. The HKDF salt/info below are specific to sealing; the scheduler
 * bearer uses its own (cron-auth.ts), so a bearer is never a sealing key. Changing SALT/INFO would
 * stop already-sealed links and codes from opening, so they stay as they are.
 *
 * Output: base64(iv[12] || ciphertext+tag).
 */

const SALT = "casevoya.invitation-email-link";
const INFO = "aes-256-gcm v1";
const IV_BYTES = 12;
const MIN_SECRET_LENGTH = 16;
const MAX_LINK_LENGTH = 600;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function linkKey(secret: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(SALT), info: encoder.encode(INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

function additionalData(invitationId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`invitation:${invitationId.toLowerCase()}`);
}

/** Only an absolute http(s) link to an accept screen is ever put in an email. */
export function isInviteLink(value: string): boolean {
  if (value.length > MAX_LINK_LENGTH) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    return url.pathname.startsWith("/invite/") || url.pathname.startsWith("/accept/");
  } catch {
    return false;
  }
}

/** The sealed link, or null when there is no usable secret or the link is not an accept link. */
export async function sealInviteLink(secret: string, link: string, invitationId: string): Promise<string | null> {
  if (secret.length < MIN_SECRET_LENGTH || !invitationId || !isInviteLink(link)) return null;
  const key = await linkKey(secret, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(invitationId) },
      key,
      encoder.encode(link),
    ),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv, 0);
  out.set(sealed, iv.length);
  return bytesToBase64(out);
}

/** The link, or null for anything that does not open cleanly. Never throws. */
export async function openInviteLink(secret: string, sealed: string, invitationId: string): Promise<string | null> {
  try {
    if (secret.length < MIN_SECRET_LENGTH || !invitationId) return null;
    const bytes = base64ToBytes(sealed);
    if (!bytes || bytes.length <= IV_BYTES + 16) return null;
    const key = await linkKey(secret, "decrypt");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES), additionalData: additionalData(invitationId) },
      key,
      bytes.slice(IV_BYTES),
    );
    const link = decoder.decode(plain);
    return isInviteLink(link) ? link : null;
  } catch {
    return null;
  }
}

/** Hex sha256 of the raw token: what the database stores as token_hash. */
export async function invitationTokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Signing codes (consultation agreements) are sealed the same way: the app makes the six-digit
 * code and its id, seals the code to that id, and stores only the sealed form and its SHA-256.
 * The mail worker opens it. A sealed code only opens for the code id it was made for.
 */
function codeData(codeId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`signing-code:${codeId.toLowerCase()}`);
}

export async function sealSigningCode(secret: string, code: string, codeId: string): Promise<string | null> {
  if (secret.length < MIN_SECRET_LENGTH || !codeId || !/^\d{6}$/.test(code)) return null;
  const key = await linkKey(secret, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: codeData(codeId) }, key, encoder.encode(code)));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv, 0);
  out.set(sealed, iv.length);
  return bytesToBase64(out);
}

/** The six-digit code, or null for anything that does not open cleanly. Never throws. */
export async function openSigningCode(secret: string, sealed: string, codeId: string): Promise<string | null> {
  try {
    if (secret.length < MIN_SECRET_LENGTH || !codeId) return null;
    const bytes = base64ToBytes(sealed);
    if (!bytes || bytes.length <= IV_BYTES + 16) return null;
    const key = await linkKey(secret, "decrypt");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, IV_BYTES), additionalData: codeData(codeId) }, key, bytes.slice(IV_BYTES));
    const code = decoder.decode(plain);
    return /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}
