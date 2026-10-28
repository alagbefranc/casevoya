"use client";

import { goStepUp } from "@/lib/auth/step-up-resume";
import { toast2 } from "@/components/port/kit";
import { createClient } from "@/lib/supabase/client";
import { completeDocumentUpload } from "@/modules/documents/actions";
import {
  addExpiryReminder,
  attachCorrespondenceEvidence,
  confirmDecision,
  prepareHandoff,
  recordCheck,
  recordCorrespondence,
  recordDecision,
  recordStep,
  recordSubmission,
  signOffHandoff,
  startEvidenceUpload,
  verifyCorrespondence,
  verifySubmission,
} from "@/modules/government/actions";
import { letterChannel, letterKind, submittedInstant } from "@/modules/government/present";
import { recordGovernmentLetter } from "@/modules/government/letter-actions";
import { readLetterForm } from "./letter-acts";
import { needsStepUp, stepUpLocation, withoutDialog, type MatterDialog } from "@/modules/sheet/matter-wire";
import { setTaskStatus } from "@/modules/tasks/actions";
import { acceptChosen, failUpload } from "./upload-failure";
import { type StepUpActionKey } from "@/lib/auth/mfa-step";

/**
 * The Sheet's government acts (T036 to T039): `data-gov` controls on the Government status page
 * and the matter's Submissions and Decisions tabs, plus file picking for the letter and receipt
 * drop zones. The database decides every change; a step-up refusal sends the person to
 * /mfa?step=6 and back. Nothing here changes the Designer's DOM except the chosen file's name.
 */
type Router = { replace: (href: string) => void; refresh: () => void };
type Result = { error?: string } | Record<string, unknown> | null | undefined;

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,application/pdf,image/jpeg,image/png,image/heic";
const picked = new WeakMap<Element, File>();

function value(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value ?? "").trim();
}

/** Opens the browser's file chooser without adding anything to the page. */
export function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/** A drop zone's Choose file (letter and receipt dialogs): keeps the file and shows its name. */
export async function pickInto(holder: Element, label: Element | null) {
  const file = await chooseFile();
  if (!file) return;
  // DES-04: a wrong type, empty or too large file is refused here with a next step and a retry.
  if (!acceptChosen(holder, file, "evidence", () => void pickInto(holder, label))) {
    picked.delete(holder);
    return;
  }
  picked.set(holder, file);
  if (label) label.textContent = file.name;
  if (holder instanceof HTMLInputElement) holder.value = file.name;
}

export function pickedFile(holder: Element | null): File | null {
  return holder ? (picked.get(holder) ?? null) : null;
}

/** Uploads a file as staff-only evidence on the matter; resolves to the stored version id. */
export async function uploadEvidence(input: { organizationId: string; matterId: string; file: File; purpose: string }): Promise<{ versionId: string } | { error: string }> {
  const intent = await startEvidenceUpload({
    organizationId: input.organizationId,
    matterId: input.matterId,
    filename: input.file.name,
    byteSize: input.file.size,
    purpose: input.purpose,
  });
  if (!intent || "error" in intent) return { error: (intent && "error" in intent && intent.error) || "The upload could not start." };
  const supabase = createClient();
  const uploaded = await supabase.storage.from("documents").uploadToSignedUrl(intent.path, intent.token, input.file);
  if (uploaded.error) return { error: "The file did not finish uploading. Try again." };
  const done = await completeDocumentUpload({ organizationId: input.organizationId, versionId: intent.versionId });
  if ("error" in done) return { error: done.error ?? "The file could not be checked." };
  if (done.uploadState !== "clean") return { error: "The file is stored but not cleared yet, so it can’t be used as evidence. Try again shortly." };
  return { versionId: intent.versionId };
}

/** The browser's date: only a fallback when the page didn't give the firm's (`data-today`). */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The matter page's Record a government letter dialog (T037): the letter is stored as received, unverified. */
export async function recordLetter(scope: ParentNode, dialog: Element | null, ref: { organizationId: string; matterId: string }): Promise<Result> {
  const selects = scope.querySelectorAll<HTMLSelectElement>("select");
  const kind = letterKind(selects[0]?.selectedOptions[0]?.textContent ?? "");
  const channel = letterChannel(selects[1]?.selectedOptions[0]?.textContent ?? "");
  const receivedOn = value(scope, 'input[type="date"]');
  if (!kind || !channel) return { error: "Choose the letter type and how it arrived." };
  if (!receivedOn) return { error: "Add the date the firm received it." };
  // GOV-04: the live dialog's issuer, letter date, filed-email file and tasks, checked before any upload.
  const live = readLetterForm(scope);
  if (live && "error" in live) return live;
  const file = pickedFile(dialog?.querySelector(".drop button") ?? null);
  let evidenceVersionId: string | null = null;
  if (file) {
    const uploaded = await uploadEvidence({ ...ref, file, purpose: `Government letter received ${receivedOn}` });
    if ("error" in uploaded) {
      const drop = dialog?.querySelector<HTMLElement>(".drop button") ?? null;
      if (drop) failUpload(drop, uploaded.error, "evidence", () => void pickInto(drop, drop.closest(".drop")?.querySelector("b") ?? null));
      return uploaded;
    }
    evidenceVersionId = uploaded.versionId;
  }
  if (live) {
    return recordGovernmentLetter({
      ...ref,
      kind,
      channel,
      receivedOn,
      documentDate: live.documentDate,
      issuerId: live.issuerId,
      issuer: live.issuer,
      statedDeadline: value(scope, "#ltD") || null,
      evidenceVersionId: evidenceVersionId ?? live.filedVersionId,
      tasks: live.tasks,
    });
  }
  return recordCorrespondence({
    ...ref,
    kind,
    channel,
    receivedOn,
    // The live dialog's "Deadline in the letter" is a date (#ltD); the Designer's was free text.
    statedDeadline: scope.querySelector("#ltD") ? value(scope, "#ltD") : value(scope, "input[placeholder]"),
    evidenceVersionId,
  });
}

const DONE: Record<string, [string, string]> = {
  prepare: ["Handoff started", "A licensed consultant signs off this package next."],
  signoff: ["Package signed off", "The representative can now submit it and record the submission."],
  submit: ["Submission recorded", "It stays unverified until the receipt is on file."],
  receipt: ["Submitted to government", "The confirmation is the evidence for the Submitted stage."],
  "receipt-file": ["Submitted to government", "The confirmation is the evidence for the Submitted stage."],
  "verify-letter": ["Letter verified", "The matter’s government status follows the verified letter."],
  "attach-letter": ["Evidence attached", "A staff member can now verify the letter against it."],
  status: ["Recorded", "It stays unverified until a staff member checks it against the evidence."],
  decision: ["Decision recorded", "A licensed consultant confirms the outcome before it counts."],
  confirm: ["Outcome confirmed", "Follow-up tasks were opened. Nothing in billing changed."],
  step: ["Step recorded", "Kept in the withdrawal record."],
  "task-done": ["Task done", "Kept in the task’s history."],
  expiry: ["Reminder added", "A renewal review task is on the matter."],
};

/** How long "Hold to approve package" must be held. */
const HOLD_MS = 900;

/**
 * Binds the government controls on a Sheet page. Clicks are taken in the capture phase, before
 * the Sheet's own handler, so a read-only checklist box never toggles and the sign-off button
 * never opens the hold dialog (it shares the Designer's `data-hold` attribute).
 */
export function bindGovControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const letterDrop = target.closest<HTMLElement>("#dLetter .drop button");
      if (letterDrop && root.contains(letterDrop) && root.querySelector('#dLetter [data-act="letter"]')) {
        event.preventDefault();
        event.stopPropagation();
        void pickInto(letterDrop, letterDrop.closest(".drop")?.querySelector("b") ?? null);
        return;
      }
      const pick = target.closest<HTMLElement>("[data-gov-pick]");
      if (pick && root.contains(pick)) {
        event.preventDefault();
        event.stopPropagation();
        void pickInto(pick, pick.closest(".drop")?.querySelector("[data-gov-name]") ?? null);
        return;
      }
      const file = target.closest<HTMLInputElement>("input[data-gov-file]");
      if (file && root.contains(file)) {
        event.preventDefault();
        event.stopPropagation();
        void pickInto(file, null);
        return;
      }
      const control = target.closest<HTMLElement>("[data-gov]");
      if (!control || !root.contains(control)) return;
      event.preventDefault();
      event.stopPropagation();
      const act = control.dataset.gov;
      if (act === "ro" || act === "signoff" || control.getAttribute("aria-busy") === "true") return;
      control.setAttribute("aria-busy", "true");
      void runGovAct(control, root, router).finally(() => control.removeAttribute("aria-busy"));
    },
    { capture: true, signal: listen.signal },
  );

  let hold: number | undefined;
  const release = () => {
    window.clearTimeout(hold);
    hold = undefined;
  };
  const press = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-gov="signoff"]');
    if (!button || !root.contains(button) || button.getAttribute("aria-busy") === "true") return;
    if (event instanceof KeyboardEvent && (event.repeat || (event.key !== "Enter" && event.key !== " "))) return;
    event.preventDefault();
    release();
    hold = window.setTimeout(() => {
      hold = undefined;
      button.setAttribute("aria-busy", "true");
      void runGovAct(button, root, router).finally(() => button.removeAttribute("aria-busy"));
    }, HOLD_MS);
  };
  root.addEventListener("pointerdown", press, listen);
  root.addEventListener("keydown", press, listen);
  for (const type of ["pointerup", "pointerout", "pointercancel", "keyup"]) root.addEventListener(type, release, listen);
}

/** Which dialog a step-up should reopen when the person comes back. */
const REOPEN: Record<string, MatterDialog> = { prepare: "handoff", submit: "submission", receipt: "receipt" };
/** SEC-01: what the step-up page says each act's check is for. */
const GOV_ACTION: Record<string, StepUpActionKey | undefined> = {
  prepare: "submission",
  signoff: "submission",
  submit: "submission",
  receipt: "submission",
  "receipt-file": "submission",
  "verify-letter": "government_letter",
  "attach-letter": "government_letter",
  status: "government_status",
  confirm: "government_status",
  decision: "decision",
  step: "decision",
  "task-done": "task_change",
  expiry: "renewal",
};

export async function runGovAct(button: HTMLElement, root: HTMLElement, router: Router) {
  const act = button.dataset.gov ?? "";
  const data = button.dataset;
  const ref = { organizationId: data.org ?? "", matterId: data.matter ?? "" };
  const version = Number(data.version);
  const dialog = button.closest("dialog");
  const scope: ParentNode = dialog ?? button.closest(".panel") ?? button.closest(".empty") ?? root;
  let result: Result;
  // A save that uploaded a file ran several server actions before this one finished, and an
  // earlier action's re-render (Supabase refreshing the session cookie re-renders the page) can
  // land over the fresh one, leaving History stale. After such a save the page is reloaded.
  let uploadedFile = false;
  const upload = async (input: Parameters<typeof uploadEvidence>[0]) => {
    const done = await uploadEvidence(input);
    if (!("error" in done)) uploadedFile = true;
    return done;
  };

  if (act === "prepare") {
    const hash = value(scope, "#spH");
    if (hash && !/^[0-9a-f]{64}$/i.test(hash)) {
      return void toast2("Check the package hash", { kind: "warn", sub: "It is the package’s sha256: 64 characters, 0–9 and a–f only. Leave it blank if you don’t have one." });
    }
    result = await prepareHandoff({ ...ref, packageLabel: value(scope, "#spL"), packageSha256: value(scope, "#spH") || null, channel: value(scope, "#spC") });
  } else if (act === "signoff") {
    result = await signOffHandoff({ organizationId: ref.organizationId, handoffId: data.id ?? "", version });
  } else if (act === "submit" || act === "receipt") {
    const file = pickedFile(dialog?.querySelector("[data-gov-pick]") ?? null);
    // GOV-03: the government confirmation as a file, and its acknowledgement date, entered
    // separately. Checked before anything is uploaded.
    if (act === "receipt" && !file) return void toast2("Add the confirmation file", { kind: "warn", sub: "Choose the government confirmation (PDF or photo)." });
    if (act === "submit" && !file && value(scope, "#srL")) {
      return void toast2("Choose the confirmation file too", { kind: "warn", sub: "Where it is kept is noted with the file. Or leave it empty and add the receipt later." });
    }
    if ((act === "receipt" && !value(scope, "#rcA")) || (act === "submit" && file && !value(scope, "#srA"))) {
      return void toast2("Add the acknowledgement date", { kind: "warn", sub: "As shown on the confirmation." });
    }
    let receiptVersionId: string | null = null;
    if (file) {
      const uploaded = await upload({ ...ref, file, purpose: "Submission receipt" });
      if ("error" in uploaded) {
        const holder = dialog?.querySelector<HTMLElement>("[data-gov-pick]") ?? button;
        return void failUpload(holder, uploaded.error, "evidence", () => void pickInto(holder, holder.closest(".drop")?.querySelector("[data-gov-name]") ?? null));
      }
      receiptVersionId = uploaded.versionId;
    }
    if (act === "submit") {
      const submittedAt = submittedInstant(value(scope, "#srT"), scope.querySelector<HTMLInputElement>("#srT")?.dataset.tz);
      result = await recordSubmission({
        organizationId: ref.organizationId,
        handoffId: data.id ?? "",
        version,
        reference: value(scope, "#srR"),
        submittedAt,
        submittedBy: value(scope, "#srB"),
        receiptVersionId,
        receiptLocator: value(scope, "#srL") || null,
        acknowledgedOn: value(scope, "#srA") || null,
      });
    } else {
      result = await verifySubmission({
        organizationId: ref.organizationId,
        handoffId: data.id ?? "",
        version,
        receiptVersionId,
        receiptLocator: value(scope, "#rcL") || null,
        acknowledgedOn: value(scope, "#rcA") || null,
      });
    }
  } else if (act === "receipt-file") {
    const file = await chooseFile();
    if (!file) return;
    const again = () => void runGovAct(button, root, router);
    if (!acceptChosen(button, file, "evidence", again)) return;
    const uploaded = await upload({ ...ref, file, purpose: "Submission receipt" });
    if ("error" in uploaded) return void failUpload(button, uploaded.error, "evidence", again);
    result = await verifySubmission({ organizationId: ref.organizationId, handoffId: data.id ?? "", version, receiptVersionId: uploaded.versionId });
  } else if (act === "verify-letter") {
    result = await verifyCorrespondence({ organizationId: ref.organizationId, correspondenceId: data.id ?? "", version });
  } else if (act === "attach-letter") {
    // A letter recorded without its evidence: choose the file, store it on the matter, attach it.
    const file = await chooseFile();
    if (!file) return;
    const again = () => void runGovAct(button, root, router);
    if (!acceptChosen(button, file, "evidence", again)) return;
    const uploaded = await upload({ ...ref, file, purpose: "Government letter" });
    if ("error" in uploaded) return void failUpload(button, uploaded.error, "evidence", again);
    result = await attachCorrespondenceEvidence({ organizationId: ref.organizationId, correspondenceId: data.id ?? "", version, evidenceVersionId: uploaded.versionId });
  } else if (act === "status") {
    const kind = value(scope, "select");
    if (kind === "check") {
      result = await recordCheck({ ...ref, note: "Checked the official channel. No change." });
    } else {
      const holder = scope.querySelector("[data-gov-file]");
      const file = pickedFile(holder);
      if (!file) return void toast2("Attach the evidence", { kind: "warn", sub: "Click Evidence to choose the letter or screenshot." });
      const uploaded = await upload({ ...ref, file, purpose: "Government status evidence" });
      if ("error" in uploaded) return void failUpload(holder ?? button, uploaded.error, "evidence", () => (holder ? void pickInto(holder, null) : undefined));
      result = await recordCorrespondence({ ...ref, kind, channel: "other", receivedOn: data.today || today(), evidenceVersionId: uploaded.versionId });
    }
  } else if (act === "decision") {
    result = await recordDecision({
      organizationId: ref.organizationId,
      correspondenceId: data.id ?? "",
      outcome: value(scope, "#decOut"),
      milestone: value(scope, "#decMil") || null,
      decidedOn: value(scope, "#decOn") || null,
      reasons: value(scope, "#decWhy") || null,
    });
  } else if (act === "confirm") {
    const nextSteps = value(scope, "#decNext");
    if (nextSteps.length < 3) return void toast2("Write the reviewed next steps", { kind: "warn", sub: "They are kept with the confirmed outcome." });
    result = await confirmDecision({ organizationId: ref.organizationId, decisionId: data.id ?? "", version, interpretation: value(scope, "#decInt") || null, nextSteps });
  } else if (act === "step") {
    result = await recordStep({ organizationId: ref.organizationId, decisionId: data.id ?? "", step: data.step ?? "" });
  } else if (act === "task-done") {
    result = await setTaskStatus({ organizationId: ref.organizationId, taskId: data.id ?? "", expectedVersion: version, status: "done" });
  } else if (act === "expiry") {
    result = await addExpiryReminder({ organizationId: ref.organizationId, decisionId: data.id ?? "", documentVersionId: data.doc ?? "", dueOn: data.due ?? "" });
  } else {
    return;
  }

  const error = result && "error" in result && typeof result.error === "string" ? result.error : null;
  if (error) {
    if (needsStepUp(error)) {
      goStepUp(stepUpLocation(window.location.pathname, window.location.search, REOPEN[act] ?? null, GOV_ACTION[act]));
      return;
    }
    toast2(error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog?.close();
  const [title, sub] = DONE[act] ?? ["Saved", "Recorded in the matter’s history."];
  toast2(title, { kind: "ok", sub });
  // Drop ?dlg= only when it is there: replacing the URL with itself can land after the
  // refresh and put the page back as it was (Government status' History stayed stale).
  const here = `${window.location.pathname}${window.location.search}`;
  const clean = withoutDialog(window.location.pathname, window.location.search);
  if (uploadedFile) {
    // The toast stays up for the reload's first moment; the page then shows the new record.
    window.setTimeout(() => window.location.replace(clean), 600);
    return;
  }
  if (clean !== here) router.replace(clean);
  router.refresh();
}
