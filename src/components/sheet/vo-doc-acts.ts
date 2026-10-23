"use client";

import { toast2 } from "@/components/port/kit";
import { reviewStepUpLocation } from "@/modules/sheet/documents-review";
import { keepReviewDraft } from "./documents-acts";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { readingHref } from "@/modules/sheet/vo-present";
import { acceptVoDocProposal, discardVoDocDraft, readDocumentWithVo, rejectVoDocProposal } from "@/modules/vo/vo-doc-actions";

type Router = { push: (href: string) => void; refresh: () => void };

/**
 * "Read with Vo" in a document's review dialog: Vo reads this version and leaves proposals on
 * the matter's Documents tab. Nothing about the document changes until a person accepts.
 */
export async function runVoRead(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  const versionId = dialog?.dataset.doc ?? "";
  toast2("Vo is reading the document", { kind: "", sub: "Usually under a minute. Nothing changes until you accept." });
  const result = await readDocumentWithVo({ organizationId: button.dataset.org ?? "", versionId });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keepReviewDraft(dialog);
      window.location.assign(reviewStepUpLocation(window.location.pathname, window.location.search, versionId));
      return;
    }
    if ("draftId" in result && result.draftId && result.matterId) {
      // The review dialog stays open: what was typed in it isn't lost. The reading waits on the matter.
      toast2(result.error, { kind: "warn", sub: "Its proposals are on the matter’s Documents tab. Your review here isn’t saved until you press Save review." });
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  if ("abstained" in result) {
    toast2("Vo couldn’t read this file", { kind: "warn", sub: "It looks blank or unreadable. Review it yourself; the run is logged." });
    return;
  }
  // Outside a review dialog (a matter's Documents tab) go straight to the proposals. In the review
  // dialog, stay: leaving would drop the decision and reason being typed, without a warning.
  if (!dialog) {
    toast2("Vo read the document", { kind: "ok", sub: "Its proposals wait on the matter’s Documents tab. Nothing changes until you accept." });
    router.push(readingHref({ matterId: result.matterId, id: result.draftId }));
    return;
  }
  toast2("Vo read the document", {
    kind: "ok",
    sub: "Its proposals wait on the matter’s Documents tab and in Vo drafts. Nothing changes until you accept. Your review here isn’t saved until you press Save review.",
  });
}

type Row = { id: string; value: string | null; checked: boolean };

/** The review panel's rows: which are ticked, and any value a person corrected. */
function panelRows(button: HTMLElement): Row[] {
  const panel = button.closest("#ocr");
  if (!panel) return [];
  return [...panel.querySelectorAll<HTMLElement>(".fieldr[data-proposal]")].map((row) => {
    const edited = row.querySelector<HTMLElement>("[data-vo-value]")?.textContent?.trim() ?? "";
    const original = row.dataset.original ?? "";
    return {
      id: row.dataset.proposal ?? "",
      value: edited && edited !== original ? edited : null,
      checked: Boolean(row.querySelector(".ck.on")),
    };
  });
}

/** Accept ticked: each ticked proposal, with its corrected value if one was typed. */
export async function runVoDocAccept(button: HTMLElement, router: Router) {
  const organizationId = button.dataset.org ?? "";
  const ticked = panelRows(button).filter((row) => row.checked);
  if (!ticked.length) {
    toast2("Tick what is right first", { kind: "warn", sub: "Nothing was changed." });
    return;
  }
  let done = 0;
  let deadlines = 0;
  for (const row of ticked) {
    const result = await acceptVoDocProposal({ organizationId, proposalId: row.id, value: row.value });
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: done ? `${done} accepted before this one.` : "Nothing was changed." });
      router.refresh();
      return;
    }
    done += 1;
    if (result.deadlineId) deadlines += 1;
  }
  toast2(`${done} accepted`, {
    kind: "ok",
    sub: deadlines ? `${deadlines} tentative ${deadlines === 1 ? "deadline" : "deadlines"} recorded; a licensed consultant confirms them.` : "Recorded with your name in the audit.",
  });
  router.refresh();
}

/** Reject the rest: every proposal not ticked. The document and the matter stay as they are. */
export async function runVoDocReject(button: HTMLElement, router: Router) {
  const organizationId = button.dataset.org ?? "";
  const rest = panelRows(button).filter((row) => !row.checked);
  if (!rest.length) {
    toast2("Everything is ticked", { kind: "warn", sub: "Untick what Vo got wrong, or accept the ticked rows." });
    return;
  }
  for (const row of rest) {
    const result = await rejectVoDocProposal({ organizationId, proposalId: row.id });
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "" });
      router.refresh();
      return;
    }
  }
  toast2(`${rest.length} rejected`, { kind: "ok", sub: "Nothing changed. The run log keeps the record." });
  router.refresh();
}

/** Vo drafts: Reject on a document reading rejects all of it. */
export async function runVoDocDiscard(button: HTMLElement, router: Router) {
  const result = await discardVoDocDraft({ organizationId: button.dataset.org ?? "", draftId: button.dataset.voDocDiscard ?? "" });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2("Reading rejected", { kind: "ok", sub: "Nothing changed. The run log keeps the record." });
  router.refresh();
}
