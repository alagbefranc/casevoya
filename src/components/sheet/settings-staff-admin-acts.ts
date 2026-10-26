"use client";

import { goStepUp } from "@/lib/auth/step-up-resume";
import { toast2 } from "@/components/port/kit";
import { withoutDialog } from "@/modules/sheet/matter-wire";
import { changeStaffRole, offboardStaff, previewOffboarding, saveContinuity, setStaffSuspended } from "@/modules/settings/settings-staff-admin-actions";
import {
  CONTINUITY_DIALOG,
  MEMBER_DIALOG,
  OFFBOARD_DIALOG,
  handoverHtml,
  offboardDone,
  offboardIntro,
  offboardItems,
  offboardTitle,
  parseOffboardFacts,
  readHandover,
  type OffboardFacts,
} from "@/modules/sheet/settings-staff-admin-present";
import { stepUpHref } from "@/lib/auth/mfa-step";

/**
 * Settings > Team and seats: the Designer's Offboard dialog (#dlgOff, press and hold), and the live
 * Change role or access (#dlgMem) and Continuity contact (#dlgCont) dialogs. The database decides;
 * a step-up refusal sends the owner to confirm it's them and reopens the dialog with their choices.
 */
type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;

const DRAFT = "cv-staff-admin";
/** How long "Hold to start offboarding" must be held. */
const HOLD_MS = 900;

function stepUp(dialog: string, draft: Record<string, string>) {
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ dialog, ...draft }));
  } catch {
    // Storage can be unavailable; the person chooses again.
  }
  const params = new URLSearchParams(window.location.search);
  params.set("dlg", dialog);
  const next = `${window.location.pathname}?${params.toString()}`;
  toast2("Confirm it’s you", { kind: "warn", sub: "Then the dialog opens again with what you chose." });
  window.setTimeout(() => goStepUp(stepUpHref(next, dialog === "dlgOff" ? "offboard" : dialog === "dlgCont" ? "continuity" : "role")), 900);
}

function refused(result: { error: string; stepUp?: boolean }, dialog: string, draft: Record<string, string>) {
  if (result.stepUp) stepUp(dialog, draft);
  else toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
}

function select(root: ParentNode, id: string): HTMLSelectElement | null {
  return root.querySelector<HTMLSelectElement>(`#${id}`);
}

/** "Grace Lin" from the Person option "Grace Lin · Licensed consultant" (the separator is a span). */
function optionName(option: HTMLOptionElement | undefined): string {
  return (option?.textContent ?? "").split(/\s{2,}/)[0]?.trim() ?? "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

// ---------------------------------------------------------------------------
// Offboard (#dlgOff)
// ---------------------------------------------------------------------------
const facts = new Map<string, OffboardFacts>();
/** Handover choices to put back after a step-up, once the person's rows are drawn. */
let pendingHandover: Record<string, Record<string, string>> | null = null;

/** ORG-06: redraws the per-item choices when the person changes; keeps them when only the receiver does. */
function renderHandover(dialog: HTMLElement, leaverId: string, known: OffboardFacts) {
  const list = dialog.querySelector<HTMLElement>("[data-handover-list]");
  const receiver = select(dialog, "ofR");
  if (!list || !receiver) return;
  if (list.dataset.for !== leaverId) {
    const receivers = [...receiver.options].map((option) => ({ label: option.textContent?.trim() ?? "", value: option.value }));
    list.innerHTML = handoverHtml(known, receivers, leaverId);
    list.dataset.for = leaverId;
  }
  if (pendingHandover) {
    list.querySelectorAll<HTMLSelectElement>("select[data-handover]").forEach((choice) => {
      const value = pendingHandover?.[choice.dataset.handover ?? ""]?.[choice.dataset.id ?? ""];
      if (value && [...choice.options].some((option) => option.value === value)) choice.value = value;
    });
    pendingHandover = null;
  }
}

function render(dialog: HTMLElement) {
  const person = select(dialog, "ofP");
  const receiver = select(dialog, "ofR");
  const leaverId = person?.value ?? "";
  // Their own work can't go to them.
  if (receiver) {
    for (const option of receiver.options) option.disabled = option.value === leaverId;
    if (receiver.selectedOptions[0]?.disabled) {
      const next = [...receiver.options].find((option) => !option.disabled);
      if (next) receiver.value = next.value;
    }
  }
  const leaver = optionName(person?.selectedOptions[0]);
  const to = optionName(receiver?.selectedOptions[0]);
  const heading = dialog.querySelector("#dlgOffH");
  if (heading) heading.textContent = offboardTitle(leaver);
  const intro = dialog.querySelector(".db > p");
  if (intro) intro.textContent = offboardIntro(leaver);
  const known = facts.get(leaverId);
  if (!known) return;
  renderHandover(dialog, leaverId, known);
  const items = offboardItems(known, leaver, to);
  dialog.querySelectorAll<HTMLLIElement>("ol.ofl > li").forEach((li, index) => {
    const item = items[index];
    if (!item) return;
    const box = li.querySelector(".ck");
    box?.classList.toggle("on", item.done);
    box?.setAttribute("aria-label", item.aria);
    const title = li.querySelector("b");
    if (title) title.textContent = item.title;
    const small = li.querySelector("small");
    if (small) {
      const parts = typeof item.detail === "string" ? [item.detail] : [...item.detail];
      small.innerHTML = parts
        .map((part, i) => {
          const last = parts.length - 1;
          const text = i === 0 ? (last === 0 ? part : `${part} `) : i === last ? ` ${part}` : ` ${part} `;
          return (i === 0 ? "" : '<span class="sep" aria-hidden="true"></span>') + escapeHtml(text);
        })
        .join("");
    }
  });
}

/** Wires the Offboard dialog's selects: a new person loads their preview; a new receiver redraws. */
export function mountOffboard(root: HTMLElement, signal: AbortSignal) {
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${OFFBOARD_DIALOG}`);
  const button = dialog?.querySelector<HTMLElement>("[data-offboard]");
  if (!dialog || !button) return;
  const person = select(dialog, "ofP");
  try {
    const initial = parseOffboardFacts(JSON.parse(dialog.dataset.facts ?? "null"));
    if (initial && person?.value) facts.set(person.value, initial);
    const list = dialog.querySelector<HTMLElement>("[data-handover-list]");
    if (list && person?.value) list.dataset.for = person.value;
  } catch {
    // No preview: the list is filled when a person is chosen.
  }
  render(dialog);
  person?.addEventListener(
    "change",
    () => {
      render(dialog);
      const id = person.value;
      if (facts.has(id)) return;
      void previewOffboarding({ organizationId: button.dataset.org ?? "", membershipId: id }).then((result) => {
        if ("error" in result) {
          toast2(result.error, { kind: "bad", sub: "Choose the person again." });
          return;
        }
        facts.set(id, result.ok);
        if (person.value === id) render(dialog);
      });
    },
    { signal },
  );
  select(dialog, "ofR")?.addEventListener("change", () => render(dialog), { signal });
}

export async function runOffboard(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const person = select(dialog, "ofP");
  const receiver = select(dialog, "ofR");
  const draft = { person: person?.value ?? "", receiver: receiver?.value ?? "" };
  if (!draft.person || !draft.receiver || draft.person === draft.receiver) {
    toast2("Choose who receives their work", { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  const leaver = optionName(person?.selectedOptions[0]);
  const to = optionName(receiver?.selectedOptions[0]);
  // ORG-06: every open lead, booking type and upcoming consultation needs its own choice.
  const choices = [...dialog.querySelectorAll<HTMLSelectElement>("[data-handover-list] select[data-handover]")].map((choice) => ({
    kind: choice.dataset.handover ?? "",
    id: choice.dataset.id ?? "",
    value: choice.value,
    label: choice.getAttribute("aria-label") ?? "",
  }));
  const handover = readHandover(choices);
  if ("missing" in handover) {
    toast2("Choose a person for each item", { kind: "bad", sub: `${handover.missing} still needs one. Nothing was changed.` });
    return;
  }
  const saved = { ...draft, handover: JSON.stringify(handover.ok) };
  const result = await offboardStaff({ organizationId: button.dataset.org ?? "", membershipId: draft.person, receiverId: draft.receiver, handover: handover.ok });
  if ("error" in result) return refused(result, OFFBOARD_DIALOG, saved);
  dialog.close();
  const done = offboardDone(result.ok, leaver, to);
  toast2(done.title, { kind: "ok", sub: done.sub });
  facts.clear();
  router.replace(withoutDialog(window.location.pathname, window.location.search));
  router.refresh();
}

/**
 * "Hold to start offboarding": taken in the capture phase so the Sheet's own handler never fires the
 * Designer's prototype behaviour, then run after a press and hold of HOLD_MS.
 */
export function bindOffboardHold(root: HTMLElement, router: Router, signal: AbortSignal) {
  root.addEventListener(
    "click",
    (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-offboard]");
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, signal },
  );
  let hold: number | undefined;
  const release = () => {
    window.clearTimeout(hold);
    hold = undefined;
  };
  const press = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-offboard]");
    if (!button || !root.contains(button) || button.getAttribute("aria-busy") === "true") return;
    if (event instanceof KeyboardEvent && (event.repeat || (event.key !== "Enter" && event.key !== " "))) return;
    event.preventDefault();
    release();
    hold = window.setTimeout(() => {
      hold = undefined;
      button.setAttribute("aria-busy", "true");
      void runOffboard(button, router).finally(() => button.removeAttribute("aria-busy"));
    }, HOLD_MS);
  };
  root.addEventListener("pointerdown", press, { signal });
  root.addEventListener("keydown", press, { signal });
  for (const type of ["pointerup", "pointerout", "pointercancel", "keyup"]) root.addEventListener(type, release, { signal });
}

// ---------------------------------------------------------------------------
// Change role or access (#dlgMem)
// ---------------------------------------------------------------------------
function syncMember(dialog: HTMLElement) {
  const option = select(dialog, "mmP")?.selectedOptions[0];
  const role = select(dialog, "mmR");
  if (option && role && option.dataset.role) role.value = option.dataset.role;
  const status = dialog.querySelector<HTMLElement>('[data-member-act="status"]');
  if (status) status.textContent = option?.dataset.suspended ? "Reactivate" : "Suspend";
}

export function mountMember(root: HTMLElement, signal: AbortSignal) {
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${MEMBER_DIALOG}`);
  if (!dialog) return;
  select(dialog, "mmP")?.addEventListener("change", () => syncMember(dialog), { signal });
}

export async function runMemberAct(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const option = select(dialog, "mmP")?.selectedOptions[0];
  const membershipId = option?.value ?? "";
  const role = select(dialog, "mmR")?.value ?? "";
  const name = option?.textContent?.split(" · ")[0] ?? "";
  const organizationId = button.dataset.org ?? "";
  const draft = { person: membershipId, role };
  if (button.dataset.memberAct === "status") {
    const suspend = !option?.dataset.suspended;
    const result = await setStaffSuspended({ organizationId, membershipId, suspended: suspend });
    if ("error" in result) return refused(result, MEMBER_DIALOG, draft);
    dialog.close();
    toast2(suspend ? `${name} is suspended` : `${name} is active again`, {
      kind: "ok",
      sub: suspend ? `Signed out of ${result.ok} ${result.ok === 1 ? "session" : "sessions"}. Their work stays with them until you offboard or reactivate them.` : "They can sign in again.",
    });
  } else {
    if (role === option?.dataset.role) {
      toast2("They already have that role", { kind: "warn", sub: "Choose a different role." });
      return;
    }
    const result = await changeStaffRole({ organizationId, membershipId, role });
    if ("error" in result) return refused(result, MEMBER_DIALOG, draft);
    dialog.close();
    toast2("Role changed", { kind: "ok", sub: "The change is in the audit log." });
  }
  router.replace(withoutDialog(window.location.pathname, window.location.search));
  router.refresh();
}

// ---------------------------------------------------------------------------
// Continuity contact (#dlgCont)
// ---------------------------------------------------------------------------
function field(dialog: ParentNode, id: string): string {
  return dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

export async function runContinuitySave(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const draft = { name: field(dialog, "ctN"), email: field(dialog, "ctE"), succession: field(dialog, "ctS") };
  const result = await saveContinuity({ organizationId: button.dataset.org ?? "", ...draft });
  if ("error" in result) return refused(result, CONTINUITY_DIALOG, draft);
  dialog.close();
  toast2("Continuity contact saved", { kind: "ok", sub: "The change is in the audit log." });
  router.replace(withoutDialog(window.location.pathname, window.location.search));
  router.refresh();
}

// ---------------------------------------------------------------------------
// Back from step-up
// ---------------------------------------------------------------------------
/** `?dlg=dlgOff|dlgMem|dlgCont`: reopens that dialog with what was chosen or typed. */
export function reopenStaffAdmin(root: HTMLElement, open: Open) {
  const id = new URLSearchParams(window.location.search).get("dlg");
  if (id !== OFFBOARD_DIALOG && id !== MEMBER_DIALOG && id !== CONTINUITY_DIALOG) return;
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${id}`);
  if (!dialog) return;
  let draft: Record<string, unknown> = {};
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (parsed?.dialog === id) draft = parsed;
  } catch {
    draft = {};
  }
  const set = (selector: string, value: unknown) => {
    const control = dialog.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
    if (!control || typeof value !== "string") return;
    if (control instanceof HTMLSelectElement && ![...control.options].some((option) => option.value === value)) return;
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (id === OFFBOARD_DIALOG) {
    try {
      pendingHandover = typeof draft.handover === "string" ? (JSON.parse(draft.handover) as Record<string, Record<string, string>>) : null;
    } catch {
      pendingHandover = null;
    }
    set("#ofP", draft.person);
    set("#ofR", draft.receiver);
  } else if (id === MEMBER_DIALOG) {
    // From People and invitations › More: `member` names the person to select.
    set("#mmP", draft.person ?? new URLSearchParams(window.location.search).get("member") ?? undefined);
    set("#mmR", draft.role);
  } else {
    set("#ctN", draft.name);
    set("#ctE", draft.email);
    set("#ctS", draft.succession);
  }
  open(id);
}
