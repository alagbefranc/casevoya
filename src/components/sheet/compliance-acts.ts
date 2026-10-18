"use client";

import { toast2 } from "@/components/port/kit";
import {
  closePrivacyRequest,
  recordComplaint,
  recordComplaintStep,
  recordPrivacyRequest,
  recordPrivacyStep,
  savePrivacyRedaction,
  saveComplianceSettings,
} from "@/modules/compliance/actions";
import { needsStepUp } from "@/modules/sheet/matter-wire";

/**
 * Compliance > Privacy requests and Complaints. Each submit reads its dialog and calls a server
 * action; the database decides. A refusal that needs a step-up keeps what was typed (this tab
 * only) and comes back with the same dialog open (`?dlg=compliance`).
 */

type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;

const DRAFT = "cv-compliance-draft";

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

/** One key per dialog opening: a double click or a retry records one request or complaint. */
function keyFor(button: HTMLElement, prefix: string): string {
  if (!button.dataset.key) button.dataset.key = `${prefix}-${crypto.randomUUID()}`;
  return button.dataset.key;
}

function done(dialog: HTMLDialogElement, router: Router, title: string, sub: string) {
  for (const button of dialog.querySelectorAll<HTMLElement>("[data-key]")) delete button.dataset.key;
  dialog.close();
  toast2(title, { kind: "ok", sub });
  const params = new URLSearchParams(window.location.search);
  params.delete("dlg");
  const query = params.toString();
  router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`);
  router.refresh();
}

function failed(dialog: HTMLDialogElement, button: HTMLElement, error: string, sub: string) {
  if (needsStepUp(error)) {
    const fields: Record<string, string | string[]> = {};
    for (const field of dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[id], select[id], textarea[id]")) {
      fields[field.id] = field instanceof HTMLSelectElement && field.multiple ? [...field.selectedOptions].map((option) => option.value) : field.value;
    }
    try {
      sessionStorage.setItem(DRAFT, JSON.stringify({ dialog: dialog.id, fields, key: button.dataset.key ?? null, line: button.dataset.line ?? null }));
    } catch {
      // Storage can be unavailable; the person opens the dialog again.
    }
    const params = new URLSearchParams(window.location.search);
    params.set("dlg", "compliance");
    window.location.assign(`/mfa?step=6&next=${encodeURIComponent(`${window.location.pathname}?${params.toString()}`)}`);
    return;
  }
  toast2(error, { kind: "bad", sub });
}

/** Back from a step-up: reopens the dialog with what was typed, then forgets it. */
export function reopenComplianceDialog(root: ParentNode, open: Open) {
  let saved: { dialog?: unknown; fields?: unknown; key?: unknown; line?: unknown } | null = null;
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  if (!saved || typeof saved.dialog !== "string") return;
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(saved.dialog)}`);
  if (!dialog) return;
  const fields = saved.fields && typeof saved.fields === "object" ? (saved.fields as Record<string, unknown>) : {};
  for (const [id, typed] of Object.entries(fields)) {
    const field = dialog.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${CSS.escape(id)}`);
    if (!field) continue;
    if (field instanceof HTMLSelectElement && field.multiple && Array.isArray(typed)) {
      for (const option of field.options) option.selected = typed.includes(option.value);
    } else if (typeof typed === "string") field.value = typed;
  }
  const submit = dialog.querySelector<HTMLElement>(".df .btn.p");
  if (submit && typeof saved.key === "string") submit.dataset.key = saved.key;
  if (submit && typeof saved.line === "string") submit.dataset.line = saved.line;
  open(dialog.id);
}

// ---------------------------------------------------------------------------
// Privacy requests
// ---------------------------------------------------------------------------

export async function runPrivacyNew(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await recordPrivacyRequest({
    organizationId: button.dataset.org ?? "",
    kind: value(dialog, "prK"),
    requesterName: value(dialog, "prN"),
    personId: value(dialog, "prP"),
    matterId: value(dialog, "prM"),
    channel: value(dialog, "prC"),
    details: value(dialog, "prD"),
    received: value(dialog, "prR"),
    assigneeMembershipId: value(dialog, "prA"),
    idempotencyKey: keyFor(button, "pr"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Privacy request recorded", "Next, check who they are.");
  router.replace(`/sheet/privacy?view=${result.id}`);
}

export async function runPrivacyStep(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await recordPrivacyStep({
    organizationId: button.dataset.org ?? "",
    requestId: button.dataset.request ?? "",
    step: button.dataset.privacyStep ?? "",
    note: value(dialog, "psN"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Step recorded", "It’s saved with your name and the time.");
}

/** "Add redaction line" (empty) or a worklist row (that line, state only). */
export function openRedaction(opener: HTMLElement, root: ParentNode, open: Open) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgPRed");
  if (!dialog) return;
  const line = opener.dataset.redactionEdit ?? "";
  const set = (id: string, text: string, locked: boolean) => {
    const field = dialog.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
    if (!field) return;
    field.value = text;
    field.disabled = locked;
  };
  set("rdR", opener.dataset.record ?? "", Boolean(line));
  set("rdT", opener.dataset.party ?? "", Boolean(line));
  set("rdW", opener.dataset.removed ?? "", Boolean(line));
  set("rdS", opener.dataset.state ?? "to_do", false);
  const save = dialog.querySelector<HTMLElement>("[data-privacy-redaction]");
  if (save) {
    if (line) save.dataset.line = line;
    else delete save.dataset.line;
  }
  open("dlgPRed");
}

export async function runRedaction(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await savePrivacyRedaction({
    organizationId: button.dataset.org ?? "",
    requestId: button.dataset.privacyRedaction ?? "",
    redactionId: button.dataset.line ?? null,
    record: value(dialog, "rdR"),
    thirdParty: value(dialog, "rdT"),
    removed: value(dialog, "rdW"),
    state: value(dialog, "rdS"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was saved.");
  done(dialog, router, "Worklist updated", "Every line must be done before the redaction step.");
}

export async function runPrivacyClose(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await closePrivacyRequest({
    organizationId: button.dataset.org ?? "",
    requestId: button.dataset.privacyClose ?? "",
    outcome: value(dialog, "pcO"),
    consentRecordId: value(dialog, "pcK") || null,
    deliveredBy: value(dialog, "pcD"),
    evidence: value(dialog, "pcE"),
    refusalReason: value(dialog, "pcR"),
    note: value(dialog, "pcN"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "The request is still open.");
  done(dialog, router, "Request closed", "The outcome and evidence are saved.");
}

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------

export async function runComplaintNew(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  if (value(dialog, "cK") === "software") {
    toast2("Software problems go to Casevoya support", { kind: "warn", sub: "This register is for complaints about your firm’s professional service. Nothing was recorded." });
    return;
  }
  const result = await recordComplaint({
    organizationId: button.dataset.org ?? "",
    complainantName: value(dialog, "cW"),
    issue: value(dialog, "cI"),
    received: value(dialog, "cD"),
    personId: value(dialog, "cP"),
    matterId: value(dialog, "cM"),
    category: value(dialog, "cG"),
    channel: value(dialog, "cH"),
    assigneeMembershipId: value(dialog, "cA"),
    idempotencyKey: keyFor(button, "cp"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Complaint recorded", "Acknowledge it next.");
  router.replace(`/sheet/complaints?view=${result.id}`);
}

export async function runComplaintStep(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await recordComplaintStep({
    organizationId: button.dataset.org ?? "",
    complaintId: button.dataset.complaint ?? "",
    step: button.dataset.complaintStep ?? "",
    on: value(dialog, "csD"),
    note: value(dialog, "csN"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was recorded.");
  done(dialog, router, "Milestone recorded", "It’s saved with your name.");
}

// ---------------------------------------------------------------------------
// Settings (firm owner)
// ---------------------------------------------------------------------------

export async function runComplianceSettings(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const organizationId = button.dataset.org ?? "";
  const result =
    button.dataset.complianceSettings === "privacy"
      ? await saveComplianceSettings({ organizationId, privacyDays: value(dialog, "psD") })
      : await saveComplianceSettings({
          organizationId,
          ackDays: value(dialog, "chA"),
          responseDays: value(dialog, "chR"),
          escalation: value(dialog, "chE"),
          handlers: [...(dialog.querySelector<HTMLSelectElement>("#chH")?.selectedOptions ?? [])].map((option) => option.value),
        });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was changed.");
  done(dialog, router, "Settings saved", "New requests and complaints use them. Existing ones keep their dates.");
}
