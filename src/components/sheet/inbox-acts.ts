"use client";

import { toast2 } from "@/components/port/kit";
import { dismissInboundEmail, fileInboundEmail, moveInboundFiles } from "@/modules/inbox/actions";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

type Router = { refresh: () => void };

function stepUp() {
  window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null));
}

function filesLine(files: number, moved: number, problem: string | null): { kind: string; sub: string } {
  if (files === 0) return { kind: "ok", sub: "No files to move. Sender access unchanged." };
  if (moved === files) return { kind: "ok", sub: `${moved === 1 ? "Its file is" : `All ${moved} files are`} in their documents, waiting for review. Sender access unchanged.` };
  return { kind: "warn", sub: `${moved} of ${files} files moved. ${problem ?? ""} The email stays in triage until its files move.`.trim() };
}

/** "Confirm match" or a person's button on an email to triage: files it to that person and matter. */
export async function runInboxFile(button: HTMLElement, router: Router) {
  const data = button.dataset;
  const result = await fileInboundEmail({
    organizationId: data.org ?? "",
    emailId: data.inboxFile ?? "",
    matterId: data.matter ?? "",
    personId: data.person ?? "",
  });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    toast2(result.error ?? "That action could not be completed.", { kind: "bad", sub: "The email is still in triage." });
    return;
  }
  const line = filesLine(result.files, result.moved, result.problem);
  toast2(`Filed to ${data.name || "the client"}`, { kind: line.kind, sub: line.sub });
  router.refresh();
}

/** "Move files" on a filed email whose files did not all move. */
export async function runInboxMove(button: HTMLElement, router: Router) {
  const result = await moveInboundFiles({ organizationId: button.dataset.org ?? "", emailId: button.dataset.inboxMove ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    toast2(result.error ?? "That action could not be completed.", { kind: "bad", sub: "Nothing was moved." });
    return;
  }
  const line = filesLine(result.files, result.moved, result.problem);
  toast2(line.kind === "ok" ? "Files moved" : "Some files didn’t move", { kind: line.kind, sub: line.sub });
  router.refresh();
}

/** "Not case mail": the email leaves triage; its files are never opened. */
export async function runInboxDismiss(button: HTMLElement, router: Router) {
  const result = await dismissInboundEmail({ organizationId: button.dataset.org ?? "", emailId: button.dataset.inboxDismiss ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    toast2(result.error ?? "That action could not be completed.", { kind: "bad", sub: "The email is still in triage." });
    return;
  }
  toast2("Removed from triage", { kind: "ok", sub: "Not case mail. Its files stay closed." });
  router.refresh();
}
