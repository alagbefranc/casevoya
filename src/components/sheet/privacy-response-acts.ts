"use client";

import { toast2 } from "@/components/port/kit";
import { dmy } from "@/modules/compliance/format";
import { CAPTURED_PROVISIONS } from "@/modules/compliance/privacy-official";
import {
  decidePrivacyItem,
  deliverPrivacyResponse,
  extendPrivacyRequest,
  proposePrivacyTimeLimit,
  reviewPrivacyTimeLimit,
  searchPrivacyRecords,
} from "@/modules/compliance/privacy-response-actions";
import { stepUpHref, type StepUpActionKey } from "@/lib/auth/mfa-step";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { done, failed, keyFor, value } from "./compliance-acts";

/**
 * SEC-06 on Compliance > Privacy requests: extend, search their records, a record's decision,
 * build, preview and deliver the response package, and the legal time limits. Each submit calls a
 * server action or route; the database decides. A step-up refusal keeps what was typed and comes
 * back with the dialog open (compliance-acts `failed`).
 */

type Router = { refresh: () => void; replace: (href: string) => void };
type Open = (id: string) => void;
type BusyRun = (button: HTMLElement, run: () => Promise<void>) => void;

/** A button outside a dialog that needs a step-up: go to the step-up page and come back here. */
function stepUp(action: StepUpActionKey) {
  window.location.assign(stepUpHref(`${window.location.pathname}${window.location.search}`, action));
}

function selected(dialog: ParentNode, id: string): string[] {
  return [...(dialog.querySelector<HTMLSelectElement>(`#${id}`)?.selectedOptions ?? [])].map((option) => option.value);
}

/** A row of "Records found": the dialog shows that record's fields and its current decision. */
export function openItem(opener: HTMLElement, root: ParentNode, open: Open) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgPItem");
  if (!dialog) return;
  const fields = (opener.dataset.fields ?? "").split(",").filter(Boolean);
  const withheld = new Set((opener.dataset.withheld ?? "").split(",").filter(Boolean));
  const select = dialog.querySelector<HTMLSelectElement>("#piF");
  if (select) {
    select.replaceChildren(
      ...fields.map((field) => {
        const option = document.createElement("option");
        option.value = field;
        option.textContent = field.replaceAll("_", " ");
        option.selected = withheld.has(field);
        return option;
      }),
    );
  }
  const decision = dialog.querySelector<HTMLSelectElement>("#piD");
  if (decision) decision.value = opener.dataset.decision ?? "include";
  const party = dialog.querySelector<HTMLInputElement>("#piT");
  if (party) party.value = opener.dataset.party ?? "";
  const reason = dialog.querySelector<HTMLTextAreaElement>("#piR");
  if (reason) reason.value = opener.dataset.reason ?? "";
  const save = dialog.querySelector<HTMLElement>("[data-privacy-item]");
  if (save) save.dataset.item = opener.dataset.itemEdit ?? "";
  open("dlgPItem");
}

/** A row of "Legal time limits": review a pending one, or retire an approved one. */
export function openLimitReview(opener: HTMLElement, root: ParentNode, open: Open) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgPTLR");
  if (!dialog) return;
  const decision = dialog.querySelector<HTMLSelectElement>("#lrD");
  const approved = opener.dataset.status === "approved";
  if (decision) {
    for (const option of decision.options) option.disabled = approved ? option.value !== "retired" : option.value === "retired";
    decision.value = approved ? "retired" : "approved";
  }
  const opened = dialog.querySelector<HTMLInputElement>("#lrO");
  if (opened) opened.disabled = approved || opener.dataset.captured === "1";
  const save = dialog.querySelector<HTMLElement>("[data-privacy-limit-review]");
  if (save) {
    save.dataset.limit = opener.dataset.limitReview ?? "";
    save.dataset.version = opener.dataset.version ?? "";
  }
  open("dlgPTLR");
}

/** "Start from" a captured provision fills the form with its text, link and dates. */
export function fillCapturedProvision(dialog: ParentNode) {
  const key = value(dialog, "plS");
  const provision = CAPTURED_PROVISIONS.find((entry) => entry.key === key);
  if (!provision) return;
  const set = (id: string, text: string) => {
    const field = dialog.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`);
    if (field) field.value = text;
  };
  set("plK", provision.kind);
  set("plL", provision.lawName);
  set("plN", provision.section);
  set("plP", provision.provisionText);
  set("plD", provision.days === null ? "" : String(provision.days));
  set("plU", provision.sourceUrl);
  set("plC", dmy(provision.currentTo));
}

async function runExtend(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await extendPrivacyRequest({
    organizationId: button.dataset.org ?? "",
    requestId: button.dataset.privacyExtend ?? "",
    newDue: value(dialog, "peD"),
    basis: value(dialog, "peB"),
    reason: value(dialog, "peR"),
    recourse: value(dialog, "peC"),
    noticeMethod: value(dialog, "peM"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "The due date didn’t change.");
  done(dialog, router, "Due date extended", "They see the new date and your reason.");
}

async function runItem(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await decidePrivacyItem({
    organizationId: button.dataset.org ?? "",
    itemId: button.dataset.item ?? "",
    decision: value(dialog, "piD"),
    fields: selected(dialog, "piF"),
    thirdParty: value(dialog, "piT"),
    reason: value(dialog, "piR"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was changed.");
  done(dialog, router, "Decision saved", "It’s on the redaction worklist too.");
}

async function runDeliver(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await deliverPrivacyResponse({
    organizationId: button.dataset.org ?? "",
    requestId: button.dataset.privacyDeliver ?? "",
    responseId: button.dataset.response ?? "",
    outcome: value(dialog, "pdO"),
    note: value(dialog, "pdN"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was delivered.");
  done(dialog, router, "Delivered through the portal", "The request is closed. Each download is recorded.");
}

async function runLimit(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await proposePrivacyTimeLimit({
    organizationId: button.dataset.org ?? "",
    kind: value(dialog, "plK"),
    lawName: value(dialog, "plL"),
    section: value(dialog, "plN"),
    provisionText: value(dialog, "plP"),
    days: value(dialog, "plD"),
    sourceUrl: value(dialog, "plU"),
    currentTo: value(dialog, "plC"),
    checkedOn: value(dialog, "plW"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was saved.");
  done(
    dialog,
    router,
    "Saved for review",
    result.captured ? "A licensed member approves it before any date uses it." : `${result.reason ?? "The page couldn’t be read."} The reviewer confirms they opened the page.`,
  );
}

async function runLimitReview(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await reviewPrivacyTimeLimit({
    organizationId: button.dataset.org ?? "",
    limitId: button.dataset.limit ?? "",
    version: Number(button.dataset.version ?? ""),
    decision: value(dialog, "lrD"),
    note: value(dialog, "lrW"),
    pageOpenedOn: value(dialog, "lrO"),
  });
  if ("error" in result) return failed(dialog, button, result.error, "Nothing was changed.");
  done(dialog, router, "Review saved", "It’s recorded with your name.");
}

async function runScope(button: HTMLElement, router: Router) {
  const result = await searchPrivacyRecords({ organizationId: button.dataset.org ?? "", requestId: button.dataset.privacyScope ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp("compliance");
    toast2(result.error, { kind: "bad", sub: "Nothing was searched." });
    return;
  }
  toast2(result.added ? `${result.added} records found` : "Nothing new found", { kind: "ok", sub: `${result.total} records on this request. Mark anything to withhold.` });
  router.refresh();
}

async function runBuild(button: HTMLElement, router: Router) {
  toast2("Building the package", { kind: "ok", sub: "This can take a minute. Stay on this page." });
  const response = await fetch("/api/privacy-responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: button.dataset.org ?? "", requestId: button.dataset.privacyBuild ?? "", key: keyFor(button, "prr") }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  delete button.dataset.key;
  if (!response.ok) {
    if (needsStepUp(body.error)) return stepUp("privacy_response");
    toast2(body.error ?? "The package could not be built.", { kind: "bad", sub: "Nothing was kept." });
    router.refresh();
    return;
  }
  toast2("Package ready", { kind: "ok", sub: "Preview it, then record the review and deliver it." });
  router.refresh();
}

async function runPreview(button: HTMLElement) {
  const response = await fetch(`/api/privacy-responses/${encodeURIComponent(button.dataset.privacyPreview ?? "")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: button.dataset.org ?? "" }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string; url?: string };
  if (!response.ok || !body.url) {
    if (needsStepUp(body.error)) return stepUp("privacy_response");
    toast2(body.error ?? "That package can’t be opened.", { kind: "bad" });
    return;
  }
  window.location.assign(body.url);
}

/** Wires a click on this page's SEC-06 controls. True when the click was one of them. */
export function handlePrivacyResponseClick(target: HTMLElement, root: HTMLElement, router: Router, open: Open, busyRun: BusyRun): boolean {
  const item = target.closest<HTMLElement>("[data-item-edit]");
  if (item && root.contains(item)) {
    openItem(item, root, open);
    return true;
  }
  const review = target.closest<HTMLElement>("[data-limit-review]");
  if (review && root.contains(review)) {
    openLimitReview(review, root, open);
    return true;
  }
  const control = target.closest<HTMLElement>(
    "[data-privacy-extend], [data-privacy-scope], [data-privacy-item], [data-privacy-build], [data-privacy-preview], [data-privacy-deliver], [data-privacy-limit], [data-privacy-limit-review]",
  );
  if (!control || !root.contains(control)) return false;
  // Buttons on the page carry no organization; the page's dialogs do.
  if (!control.dataset.org) control.dataset.org = root.querySelector<HTMLElement>("dialog [data-org]")?.dataset.org ?? "";
  const data = control.dataset;
  const run =
    data.privacyExtend !== undefined
      ? () => runExtend(control, router)
      : data.privacyScope !== undefined
        ? () => runScope(control, router)
        : data.privacyItem !== undefined
          ? () => runItem(control, router)
          : data.privacyBuild !== undefined
            ? () => runBuild(control, router)
            : data.privacyPreview !== undefined
              ? () => runPreview(control)
              : data.privacyDeliver !== undefined
                ? () => runDeliver(control, router)
                : data.privacyLimitReview !== undefined
                  ? () => runLimitReview(control, router)
                  : () => runLimit(control, router);
  busyRun(control, run);
  return true;
}

/** "Start from" in Add legal time limit. */
export function bindPrivacyResponseControls(root: HTMLElement, signal: AbortSignal) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dlgPTL");
  dialog?.addEventListener(
    "change",
    (event) => {
      if ((event.target as HTMLElement | null)?.id === "plS") fillCapturedProvision(dialog);
    },
    { signal },
  );
}
