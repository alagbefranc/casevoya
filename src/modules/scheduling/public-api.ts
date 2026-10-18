/**
 * The public booking API (BUILD-SPEC §3), free consultations only. Route handlers wire these to
 * Supabase; tests pass fakes. Nothing here reads the clock except through `deps.now`.
 *
 *   GET  /api/book/[firm]/[event]          the published type (no staff names, no ids but the type's)
 *   GET  /api/book/[firm]/[event]/slots    encoded UTC starts for a range of up to 62 days
 *   POST /api/book/[firm]/[event]/hold     re-checks the start here and in the database, then books
 */
import { z } from "zod";
import { parseAvailability, slotsFromAvailability } from "./availability";
import { locationLabel } from "./format";
import { buildIcs } from "./ics";
import { encodeStarts, isTimeZone } from "./slots";

const DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 62;
/** A person needs at least this long between seeing the form and sending it. */
export const MIN_FORM_MS = 2500;

export type PublicEvent = {
  eventTypeId: string;
  firmName: string;
  firmSlug: string;
  firmTimeZone: string;
  slug: string;
  title: string;
  description: string | null;
  durationMin: number;
  locationKind: string;
  locationDetail: string | null;
  priceCents: number;
  currency: string;
  minNoticeMin: number;
  maxAdvanceDays: number;
};

export type HoldArgs = {
  p_firm_slug: string;
  p_event_slug: string;
  p_start: string;
  p_name: string;
  p_email: string;
  p_phone: string | null;
  p_time_zone: string;
  p_idempotency_key: string;
  p_client_hash: string | null;
};

export type PublicDeps = {
  event: (firm: string, event: string) => Promise<unknown>;
  busy: (eventTypeId: string, fromIso: string, toIso: string) => Promise<unknown>;
  hold: (args: HoldArgs) => Promise<unknown>;
  now: () => number;
};

export type ApiResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function parsePublicEvent(raw: unknown): PublicEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.event_type_id !== "string" || typeof row.title !== "string" || typeof row.duration_min !== "number") return null;
  return {
    eventTypeId: row.event_type_id,
    firmName: String(row.firm_name ?? ""),
    firmSlug: String(row.firm_slug ?? ""),
    firmTimeZone: isTimeZone(row.firm_time_zone) ? row.firm_time_zone : "America/Toronto",
    slug: String(row.slug ?? ""),
    title: row.title,
    description: typeof row.description === "string" ? row.description : null,
    durationMin: row.duration_min,
    locationKind: String(row.location_kind ?? "video"),
    locationDetail: typeof row.location_detail === "string" ? row.location_detail : null,
    priceCents: typeof row.price_cents === "number" ? row.price_cents : 0,
    currency: String(row.currency ?? "CAD"),
    minNoticeMin: typeof row.min_notice_min === "number" ? row.min_notice_min : 0,
    maxAdvanceDays: typeof row.max_advance_days === "number" ? row.max_advance_days : 60,
  };
}

async function loadEvent(deps: PublicDeps, firm: string, event: string): Promise<PublicEvent | null> {
  if (!SLUG.test(firm) || !SLUG.test(event)) return null;
  const event_ = parsePublicEvent(await deps.event(firm, event));
  // Paid types are never offered on this page (a booking fee is an advance; not built).
  return event_ && event_.priceCents === 0 ? event_ : null;
}

const NOT_FOUND: ApiResult = { status: 404, body: { error: "not_found", message: "This booking page isn’t available." } };

export async function getPublicEvent(deps: PublicDeps, firm: string, event: string): Promise<ApiResult> {
  const found = await loadEvent(deps, firm, event);
  if (!found) return NOT_FOUND;
  return { status: 200, body: { event: found }, headers: { "Cache-Control": "public, max-age=30" } };
}

function dayStart(ms: number) {
  return Math.floor(ms / DAY) * DAY;
}

/** Slot starts for [from, to), clamped to now and to a 62-day range. */
export async function getPublicSlots(
  deps: PublicDeps,
  firm: string,
  event: string,
  query: { from?: string | null; to?: string | null; tz?: string | null },
): Promise<ApiResult> {
  const found = await loadEvent(deps, firm, event);
  if (!found) return NOT_FOUND;
  const now = deps.now();
  const from = Math.max(query.from ? Date.parse(query.from) : now, now);
  const requestedTo = query.to ? Date.parse(query.to) : from + 14 * DAY;
  if (!Number.isFinite(from) || !Number.isFinite(requestedTo) || requestedTo <= from) {
    return { status: 400, body: { error: "bad_range", message: "Choose a valid date range." } };
  }
  const to = Math.min(requestedTo, from + MAX_RANGE_DAYS * DAY);
  const tz = isTimeZone(query.tz) ? query.tz : found.firmTimeZone;
  const payload = parseAvailability(await deps.busy(found.eventTypeId, new Date(from).toISOString(), new Date(to).toISOString()));
  if (!payload) return { status: 502, body: { error: "unavailable", message: "Times couldn’t be loaded. Try again." } };
  const starts = slotsFromAvailability(payload, { fromUtc: from, toUtc: to, nowUtc: now }).filter((s) => s >= from && s < to);
  return {
    status: 200,
    body: { starts: encodeStarts(starts), tz, from: new Date(from).toISOString(), to: new Date(to).toISOString(), durationMin: found.durationMin },
    headers: { "Cache-Control": `public, max-age=30`, Vary: "Accept-Encoding" },
  };
}

export const holdSchema = z.object({
  start: z.string().datetime({ offset: true }),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[0-9+() .-]*$/)
    .optional()
    .nullable(),
  tz: z.string().min(1).max(64),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_:-]{8,180}$/),
  /** Honeypot: a hidden field people never fill. */
  website: z.string().max(200).optional().nullable(),
  /** Milliseconds the form was open before it was sent. */
  elapsedMs: z.number().int().min(0).max(86_400_000),
});

export type HoldBody = z.infer<typeof holdSchema>;

const HOLD_ERRORS: Record<string, ApiResult> = {
  slot_unavailable: { status: 409, body: { error: "slot_unavailable", message: "That time was just taken. Please choose another." } },
  booking_rate_limited: { status: 429, body: { error: "rate_limited", message: "Too many booking attempts. Please wait a few minutes." } },
  name_required: { status: 400, body: { error: "name_required", message: "Enter your name." } },
  email_invalid: { status: 400, body: { error: "email_invalid", message: "Enter a valid email address." } },
  phone_invalid: { status: 400, body: { error: "phone_invalid", message: "Enter a valid phone number." } },
  time_zone_invalid: { status: 400, body: { error: "time_zone_invalid", message: "Choose your time zone." } },
};

export type BookingSummary = {
  publicRef: string;
  status: string;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  title: string;
  hostName: string | null;
  firmName: string;
  timeZone: string;
  hostTimeZone: string;
  locationKind: string;
  locationDetail: string | null;
  icsSequence: number;
};

export function parseSummary(raw: unknown): BookingSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.public_ref !== "string" || typeof row.starts_at !== "string" || typeof row.ends_at !== "string") return null;
  return {
    publicRef: row.public_ref,
    status: String(row.status ?? ""),
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    durationMin: typeof row.duration_min === "number" ? row.duration_min : 0,
    title: String(row.title ?? ""),
    hostName: typeof row.host_name === "string" ? row.host_name : null,
    firmName: String(row.firm_name ?? ""),
    timeZone: String(row.time_zone ?? "UTC"),
    hostTimeZone: String(row.host_time_zone ?? "UTC"),
    locationKind: String(row.location_kind ?? "video"),
    locationDetail: typeof row.location_detail === "string" ? row.location_detail : null,
    icsSequence: typeof row.ics_sequence === "number" ? row.ics_sequence : 0,
  };
}

/** The confirmation's calendar file. The same UID is used for every later update. */
export function summaryIcs(summary: BookingSummary, stampedAt: number): string {
  return buildIcs({
    publicRef: summary.publicRef,
    sequence: summary.icsSequence,
    startsAt: summary.startsAt,
    endsAt: summary.endsAt,
    title: summary.title,
    firmName: summary.firmName,
    location: summary.locationKind === "meeting_link" ? summary.locationDetail : locationLabel(summary.locationKind, summary.locationDetail),
    url: summary.locationKind === "meeting_link" ? summary.locationDetail : null,
    cancelled: summary.status === "cancelled",
    stampedAt,
  });
}

export async function postPublicHold(deps: PublicDeps, firm: string, event: string, body: unknown, clientHash: string | null): Promise<ApiResult> {
  const parsed = holdSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "invalid", message: "Check the form and try again." } };
  const input = parsed.data;
  // Basic abuse checks before any database work. A filled honeypot gets the same answer as a
  // refused slot, so a bot learns nothing.
  if (input.website) return HOLD_ERRORS.slot_unavailable;
  if (input.elapsedMs < MIN_FORM_MS) return { status: 429, body: { error: "too_fast", message: "Please take a moment to check your details, then send again." } };
  if (!isTimeZone(input.tz)) return HOLD_ERRORS.time_zone_invalid;
  const found = await loadEvent(deps, firm, event);
  if (!found) return NOT_FOUND;

  // Re-check the start with the slot library (the database checks it again and takes the slot
  // under the exclusion constraint).
  const start = Date.parse(input.start);
  const now = deps.now();
  const payload = parseAvailability(await deps.busy(found.eventTypeId, new Date(start - DAY).toISOString(), new Date(start + DAY).toISOString()));
  if (!payload) return { status: 502, body: { error: "unavailable", message: "Times couldn’t be checked. Try again." } };
  const offered = slotsFromAvailability(payload, { fromUtc: dayStart(start - DAY), toUtc: dayStart(start + 2 * DAY), nowUtc: now });
  if (!offered.includes(start)) return HOLD_ERRORS.slot_unavailable;

  let raw: unknown;
  try {
    raw = await deps.hold({
      p_firm_slug: firm,
      p_event_slug: event,
      p_start: new Date(start).toISOString(),
      p_name: input.name,
      p_email: input.email,
      p_phone: input.phone || null,
      p_time_zone: input.tz,
      p_idempotency_key: input.idempotencyKey,
      p_client_hash: clientHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/idempotency key reused/.test(message)) return { status: 409, body: { error: "conflict", message: "This request was already used for another time. Reload the page." } };
    if (/not found/.test(message)) return NOT_FOUND;
    return { status: 502, body: { error: "unavailable", message: "The booking couldn’t be saved. Try again." } };
  }
  const refusal = raw && typeof raw === "object" ? (raw as Record<string, unknown>).error : undefined;
  if (typeof refusal === "string") return HOLD_ERRORS[refusal] ?? { status: 400, body: { error: "refused", message: "The booking couldn’t be made." } };
  const summary = parseSummary(raw);
  if (!summary) return { status: 502, body: { error: "unavailable", message: "The booking couldn’t be saved. Try again." } };
  // Never report a booking as confirmed unless the database says it is (REPORT §10.7).
  const confirmed = summary.status === "confirmed";
  return {
    status: confirmed ? 201 : 202,
    body: { booking: summary, ics: confirmed ? summaryIcs(summary, now) : null },
    headers: { "Cache-Control": "no-store" },
  };
}

/** sha256 hex of the client address with a prefix (and an optional deployment salt). */
export async function clientHash(address: string | null, salt = ""): Promise<string | null> {
  const ip = (address ?? "").split(",")[0].trim();
  if (!ip || ip.length > 64) return null;
  const data = new TextEncoder().encode(`casevoya-booking:${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
