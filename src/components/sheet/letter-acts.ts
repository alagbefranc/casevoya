"use client";

import { toast2 } from "@/components/port/kit";
import { proposeGovernmentIssuer, reviewGovernmentIssuer } from "@/modules/government/letter-actions";
import { readLetterTasks, type LetterTask } from "@/modules/government/letters";
import { readAttestationFrom } from "@/modules/government/page-attestation";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

/**
 * GOV-04 Sheet acts: the live fields of Record a government letter (issuer, letter date, a file
 * from a filed email, tasks from this letter) and the Decisions tab's issuer list (Add an issuer,
 * Approve, Reject, Retire). The database decides every change; a step-up refusal sends the person
 * to /mfa?step=6 and back.
 */
type Router = { refresh: () => void };

const OTHER = "other";

function field(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? "").trim();
}

export type LetterFormRead = {
  issuerId: string | null;
  issuer: string | null;
  documentDate: string | null;
  filedVersionId: string | null;
  tasks: LetterTask[];
};

/**
 * The dialog's live fields, checked before anything is uploaded: null when the dialog has none
 * (the Designer's own dialog), an error when the issuer or a task row is incomplete.
 */
export function readLetterForm(scope: ParentNode): LetterFormRead | { error: string } | null {
  const form = scope.querySelector<HTMLElement>("[data-letter-form]");
  if (!form) return null;
  const today = form.dataset.today ?? "";
  const chosen = field(form, "#ltI");
  const issuerId = chosen && chosen !== OTHER ? chosen : null;
  const issuer = issuerId ? null : field(form, "#ltIo") || null;
  if (!issuerId && !issuer) return { error: "Choose who sent the letter, or type it under Other." };
  const documentDate = field(form, "#ltDd") || null;
  if (documentDate && today && documentDate > today) return { error: "The letter date can’t be in the future." };
  const rows = [...form.querySelectorAll<HTMLElement>("[data-letter-task]")].map((row) => ({
    title: field(row, ".lt-t"),
    owner: field(row, ".lt-o"),
    due: field(row, ".lt-d"),
  }));
  const read = readLetterTasks(rows, today);
  if ("error" in read) return read;
  return { issuerId, issuer, documentDate, filedVersionId: field(form, "#ltE") || null, tasks: read.tasks };
}

/** Shows the chosen issuer's source under the field, and the typed field for Other. */
function syncIssuer(select: HTMLSelectElement) {
  const form = select.closest("[data-letter-form]");
  if (!form) return;
  const other = select.value === OTHER;
  const typed = form.querySelector<HTMLElement>("#ltIoL");
  if (typed) typed.hidden = !other;
  const hint = form.querySelector<HTMLElement>("#ltIs");
  if (hint) {
    hint.textContent = other
      ? "Typed by you for this letter only; it has no official source on file. Add official names with their source on the Decisions tab."
      : (select.selectedOptions[0]?.dataset.src ?? "");
  }
}

/** Add another task: shows the next hidden row; the button goes once every row shows. */
function addTaskRow(button: HTMLElement) {
  const form = button.closest("[data-letter-form]");
  const next = form?.querySelector<HTMLElement>("[data-letter-task][hidden]");
  if (!next) return;
  next.hidden = false;
  next.querySelector<HTMLInputElement>(".lt-t")?.focus();
  if (!form?.querySelector("[data-letter-task][hidden]")) button.hidden = true;
}

const DONE: Record<string, [string, string]> = {
  propose: ["Issuer added", "A licensed member approves it before it’s offered for letters."],
  approved: ["Issuer approved", "It’s offered in Record a government letter, with its source."],
  rejected: ["Issuer rejected", "It isn’t offered. The note is kept."],
  retired: ["Issuer retired", "Letters that name it keep it; new letters can’t choose it."],
};

async function runIssuerAct(button: HTMLElement, router: Router) {
  const act = button.dataset.issuer ?? "";
  const organizationId = button.dataset.org ?? "";
  let result: { error?: string } | Record<string, unknown>;
  if (act === "propose") {
    const dialog = button.closest("dialog");
    const scope: ParentNode = dialog ?? document;
    const name = field(scope, "#isN");
    const sourceUrl = field(scope, "#isU");
    const checkedOn = field(scope, "#isC");
    if (!name || !sourceUrl || !checkedOn) return void toast2("Add the name, the official page and the date you checked it", { kind: "warn", sub: "Nothing was saved." });
    result = await proposeGovernmentIssuer({ organizationId, name, sourceUrl, checkedOn });
    if (!("error" in result) || !result.error) {
      dialog?.close();
      const read = result as { read?: boolean; nameOnPage?: boolean | null };
      const sub = !read.read
        ? "The page couldn’t be read from here, so it’s marked “page not read”. A licensed member checks it before approving."
        : read.nameOnPage === false
          ? "The page was read, but the name wasn’t found in its text. Check the spelling before it’s approved."
          : DONE.propose[1];
      toast2(DONE.propose[0], { kind: read.read && read.nameOnPage !== false ? "ok" : "warn", sub });
      router.refresh();
      return;
    }
  } else if (act === "approved" || act === "rejected" || act === "retired") {
    const row = button.closest("[data-issuer-row]") ?? document;
    const note = field(row, "[data-issuer-note]");
    if (act !== "approved" && note.length < 3) return void toast2("Say why", { kind: "warn", sub: "Type the reason in the field on this issuer’s row." });
    // The page wasn't read: the row carries the reviewer's attestation fields.
    const attested = act === "approved" ? readAttestationFrom(row) : null;
    if (attested && "error" in attested) return void toast2(attested.error, { kind: "warn", sub: "Nothing was saved." });
    result = await reviewGovernmentIssuer({
      organizationId,
      issuerId: button.dataset.id ?? "",
      version: Number(button.dataset.version),
      decision: act,
      note: act === "approved" ? null : note,
      pageOpenedOn: attested?.openedOn ?? null,
    });
  } else {
    return;
  }
  const error = "error" in result && typeof result.error === "string" ? result.error : null;
  if (error) {
    if (needsStepUp(error)) {
      window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null, "government_letter"));
      return;
    }
    toast2(error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  const [title, sub] = DONE[act] ?? ["Saved", ""];
  toast2(title, { kind: "ok", sub });
  router.refresh();
}

export function bindLetterControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "change",
    (event) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLSelectElement && target.id === "ltI" && root.contains(target)) syncIssuer(target);
    },
    listen,
  );
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const add = target.closest<HTMLElement>("[data-letter-add]");
      if (add && root.contains(add)) {
        event.preventDefault();
        addTaskRow(add);
        return;
      }
      const control = target.closest<HTMLElement>("[data-issuer]");
      if (!control || !root.contains(control) || control.tagName !== "BUTTON") return;
      event.preventDefault();
      if (control.getAttribute("aria-busy") === "true") return;
      control.setAttribute("aria-busy", "true");
      void runIssuerAct(control, router).finally(() => control.removeAttribute("aria-busy"));
    },
    listen,
  );
}
