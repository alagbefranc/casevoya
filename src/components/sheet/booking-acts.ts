"use client";

import { toast2 } from "@/components/port/kit";
import {
  bookForClient,
  cancelBooking,
  recordBookingOutcome,
  rescheduleBooking,
  rescheduleOptions,
  saveAvailability,
  saveBookingType,
} from "@/modules/scheduling/staff-actions";

type Router = { refresh: () => void };
type Open = (id: string) => void;

function el<T extends HTMLElement = HTMLInputElement>(root: ParentNode, id: string): T | null {
  return root.querySelector<T>(`#${id}`);
}

function value(root: ParentNode, id: string): string {
  return el<HTMLInputElement | HTMLSelectElement>(root, id)?.value ?? "";
}

function key(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`;
}

/** The step-up screen, back to this page afterwards. The dialog is opened again by hand. */
function stepUp() {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`);
}

function first(name: string): string {
  return name.trim().split(/\s+/)[0] || "The client";
}

function done(result: { ok: true } | { error: string; stepUp?: boolean }, success: { title: string; sub: string }, dialog: HTMLDialogElement | null, router: Router) {
  if ("error" in result) {
    if (result.stepUp) {
      toast2("Confirm it’s you", { kind: "warn", sub: result.error });
      window.setTimeout(stepUp, 900);
      return false;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return false;
  }
  dialog?.close();
  toast2(success.title, { kind: "ok", sub: success.sub });
  router.refresh();
  return true;
}

// ---------------------------------------------------------------------------
// Book for a client
// ---------------------------------------------------------------------------

/** Only the free times of the chosen booking type are offered. */
export function syncBookTimes(dialog: ParentNode) {
  const type = value(dialog, "bkT");
  const select = el<HTMLSelectElement>(dialog, "bkS");
  if (!select) return;
  for (const option of select.options) {
    const fits = !type || !option.dataset.type || option.dataset.type === type;
    option.hidden = !fits;
    option.disabled = !fits;
  }
  if (select.selectedOptions[0]?.disabled) {
    select.value = [...select.options].find((option) => !option.disabled)?.value ?? "";
  }
}

async function runBook(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const personId = value(dialog, "bkC");
  const time = el<HTMLSelectElement>(dialog, "bkS")?.selectedOptions[0];
  const start = time?.value ?? "";
  const eventTypeId = value(dialog, "bkT") || time?.dataset.type || "";
  if (!personId || !start || !eventTypeId) {
    toast2("Choose a client and a time", { kind: "warn", sub: "Nothing was booked." });
    return;
  }
  button.dataset.key ||= key();
  const result = await bookForClient({
    organizationId: button.dataset.org ?? "",
    eventTypeId,
    personId,
    start,
    timeZone: button.dataset.tz ?? "",
    idempotencyKey: button.dataset.key,
  });
  if (done(result, { title: "Consultation booked", sub: "They get a confirmation email with the time in their timezone." }, dialog, router)) delete button.dataset.key;
}

// ---------------------------------------------------------------------------
// Reschedule and cancel
// ---------------------------------------------------------------------------

/** Fills Reschedule (#dlgRes) or Cancel (#dlgCan) for the row's booking and opens it. */
export async function openBooking(opener: HTMLElement, root: HTMLElement, open: Open) {
  const id = opener.dataset.booking ?? "";
  const name = opener.dataset.name ?? "the client";
  const kind = opener.dataset.bookingOpen;
  const dialog = root.querySelector<HTMLDialogElement>(kind === "res" ? "#dlgRes" : "#dlgCan");
  const submit = dialog?.querySelector<HTMLElement>("[data-booking-submit]");
  if (!dialog || !submit) return;
  submit.dataset.booking = id;
  submit.dataset.version = opener.dataset.version ?? "";
  if (kind === "can") {
    const body = dialog.querySelector(".db p");
    if (body) body.textContent = `${name} is told by email. No fee was taken, so there’s nothing to refund.`;
    open("dlgCan");
    return;
  }
  const heading = dialog.querySelector("h2");
  if (heading) heading.textContent = `Reschedule ${first(name)}’s consultation`;
  const note = dialog.querySelector(".db .fp-note");
  if (note) note.textContent = `${first(name)} gets an email with the new time, in their own timezone.`;
  const select = el<HTMLSelectElement>(dialog, "rsS");
  if (select) select.replaceChildren(new Option("Loading free times…", ""));
  open("dlgRes");
  const result = await rescheduleOptions({ organizationId: submit.dataset.org ?? "", bookingId: id, timeZone: submit.dataset.tz ?? "" });
  if (!select) return;
  if ("error" in result) {
    select.replaceChildren(new Option(result.error, ""));
    return;
  }
  select.replaceChildren(...(result.options.length ? result.options.map((option) => new Option(option.label, option.value)) : [new Option("No free times in the next 4 weeks", "")]));
}

export async function runBookingSubmit(button: HTMLElement, router: Router) {
  const kind = button.dataset.bookingSubmit;
  if (kind === "book") return runBook(button, router);
  const dialog = button.closest("dialog");
  const organizationId = button.dataset.org ?? "";
  const bookingId = button.dataset.booking ?? "";
  const version = button.dataset.version ? Number(button.dataset.version) : null;
  if (kind === "res") {
    const start = dialog ? value(dialog, "rsS") : "";
    if (!start) {
      toast2("Choose a new time", { kind: "warn", sub: "Nothing was changed." });
      return;
    }
    const result = await rescheduleBooking({ organizationId, bookingId, version, start });
    done(result, { title: "Rescheduled", sub: "They get an email with the new time." }, dialog, router);
    return;
  }
  const result = await cancelBooking({ organizationId, bookingId, version });
  done(result, { title: "Consultation cancelled", sub: "They get an email. The time is free again." }, dialog, router);
}

export async function runOutcome(button: HTMLElement, router: Router) {
  // The page's dialogs carry the firm id; the row button only names the booking.
  const organizationId = document.querySelector<HTMLElement>("[data-booking-submit][data-org]")?.dataset.org ?? "";
  const result = await recordBookingOutcome({ organizationId, bookingId: button.dataset.booking ?? "", outcome: button.dataset.bookingOutcome ?? "" });
  done(result, { title: button.dataset.bookingOutcome === "no_show" ? "Marked as a no-show" : "Marked as attended", sub: "The consultation record is updated." }, null, router);
}

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

export function openAvailability(opener: HTMLElement, root: HTMLElement, open: Open) {
  const dialog = root.querySelector<HTMLDialogElement>("#dlgAvail");
  const submit = dialog?.querySelector<HTMLElement>("[data-avail-submit]");
  if (!dialog || !submit) return;
  submit.dataset.membership = opener.dataset.availOpen ?? "";
  const heading = dialog.querySelector("h2");
  if (heading) heading.textContent = `Working hours · ${opener.dataset.availName ?? ""}`.replace(/ · $/, "");
  const zone = el<HTMLSelectElement>(dialog, "avZ");
  if (zone) {
    const tz = opener.dataset.availTz ?? "";
    if (tz && ![...zone.options].some((option) => option.value === tz)) zone.add(new Option(tz.replaceAll("_", " "), tz), 0);
    zone.value = tz || zone.value;
  }
  let rules: { weekday: number; start: string; end: string }[] = [];
  try {
    rules = JSON.parse(opener.dataset.availRules ?? "[]");
  } catch {
    rules = [];
  }
  for (let day = 1; day <= 7; day++) {
    const rule = rules.find((item) => item.weekday === day);
    const start = el(dialog, `avS${day}`);
    const end = el(dialog, `avE${day}`);
    if (start) start.value = rule?.start ?? "";
    if (end) end.value = rule ? (rule.end === "24:00" ? "23:59" : rule.end) : "";
  }
  const off = el(dialog, "avOff");
  if (off) off.value = opener.dataset.availOff ?? "";
  open("dlgAvail");
}

export async function runAvailability(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const rules: { weekday: number; start: string; end: string }[] = [];
  for (let day = 1; day <= 7; day++) {
    const start = value(dialog, `avS${day}`).slice(0, 5);
    const rawEnd = value(dialog, `avE${day}`).slice(0, 5);
    if (!start && !rawEnd) continue;
    if (!start || !rawEnd) {
      toast2("Give each working day a start and an end", { kind: "warn", sub: "Nothing was saved." });
      return;
    }
    rules.push({ weekday: day, start, end: rawEnd === "23:59" ? "24:00" : rawEnd });
  }
  const daysOff = value(dialog, "avOff")
    .split(/[\s,]+/)
    .map((day) => day.trim())
    .filter(Boolean);
  if (daysOff.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day))) {
    toast2("Write days off as YYYY-MM-DD", { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const result = await saveAvailability({
    organizationId: button.dataset.org ?? "",
    membershipId: button.dataset.membership ?? "",
    timeZone: value(dialog, "avZ"),
    rules,
    daysOff,
  });
  done(result, { title: "Working hours saved", sub: "New bookings use these hours. Existing bookings stay." }, dialog, router);
}

// ---------------------------------------------------------------------------
// Booking types (firm owner, step-up)
// ---------------------------------------------------------------------------

type TypeDraft = {
  id: string | null;
  version: number | null;
  title: string;
  slug: string;
  description: string;
  duration: number;
  step: number | null;
  before: number;
  after: number;
  noticeHours: number;
  advance: number;
  capacity: number | null;
  kind: string;
  detail: string;
  hosts: string[];
  published: boolean;
};

const NEW_TYPE: TypeDraft = {
  id: null,
  version: null,
  title: "Initial consultation",
  slug: "initial-consultation",
  description: "",
  duration: 30,
  step: null,
  before: 0,
  after: 15,
  noticeHours: 24,
  advance: 60,
  capacity: null,
  kind: "video",
  detail: "",
  hosts: [],
  published: false,
};

export function openBookingType(opener: HTMLElement, root: HTMLElement, open: Open) {
  const dialog = root.querySelector<HTMLDialogElement>("#dlgType");
  const submit = dialog?.querySelector<HTMLElement>("[data-type-submit]");
  if (!dialog || !submit) return;
  let draft = NEW_TYPE;
  if (opener.dataset.typeOpen !== "new") {
    try {
      draft = { ...NEW_TYPE, ...JSON.parse(opener.dataset.type ?? "{}") };
    } catch {
      draft = NEW_TYPE;
    }
  }
  submit.dataset.typeId = draft.id ?? "";
  submit.dataset.version = draft.version == null ? "" : String(draft.version);
  const set = (id: string, v: string) => {
    const input = el<HTMLInputElement | HTMLSelectElement>(dialog, id);
    if (input) input.value = v;
  };
  set("etT", draft.title);
  set("etS", draft.slug);
  set("etD", draft.description);
  set("etL", String(draft.duration));
  set("etP", draft.step == null ? "" : String(draft.step));
  set("etBB", String(draft.before));
  set("etBA", String(draft.after));
  set("etN", String(draft.noticeHours));
  set("etW", String(draft.advance));
  set("etC", draft.capacity == null ? "" : String(draft.capacity));
  set("etK", draft.kind);
  set("etX", draft.detail);
  dialog.querySelectorAll<HTMLInputElement>('input[name="etH"]').forEach((box) => {
    box.checked = draft.hosts.includes(box.value);
  });
  const publish = el(dialog, "etPub");
  if (publish) publish.checked = draft.published;
  open("dlgType");
}

export async function runBookingType(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const int = (id: string, fallback: number) => {
    const n = Number(value(dialog, id));
    return Number.isFinite(n) && value(dialog, id) !== "" ? Math.round(n) : fallback;
  };
  const optional = (id: string) => (value(dialog, id) === "" ? null : int(id, 0));
  const result = await saveBookingType({
    organizationId: button.dataset.org ?? "",
    eventTypeId: button.dataset.typeId || null,
    version: button.dataset.version ? Number(button.dataset.version) : null,
    title: value(dialog, "etT"),
    slug: value(dialog, "etS"),
    description: value(dialog, "etD"),
    durationMin: int("etL", 30),
    stepMin: optional("etP"),
    bufferBeforeMin: int("etBB", 0),
    bufferAfterMin: int("etBA", 0),
    minNoticeHours: int("etN", 24),
    maxAdvanceDays: int("etW", 60),
    dailyCapacity: optional("etC"),
    locationKind: value(dialog, "etK"),
    locationDetail: value(dialog, "etX"),
    hostMembershipIds: [...dialog.querySelectorAll<HTMLInputElement>('input[name="etH"]:checked')].map((box) => box.value),
    publish: Boolean(el(dialog, "etPub")?.checked),
  });
  done(result, { title: "Booking type saved", sub: "The booking page shows published types only." }, dialog, router);
}

/** Copy link: the share URL to the clipboard (the Designer's toast still shows). */
export async function copyLink(button: HTMLElement) {
  const text = button.dataset.copy;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast2("Copy this link", { sub: text, duration: 20_000 });
  }
}
