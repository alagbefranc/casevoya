"use client";

import { toast2 } from "@/components/port/kit";
import {
  discardVoCrmDraft,
  draftLeadFollowUp,
  markLeadFollowUpSent,
  saveCallSummary,
  saveLeadFollowUpToMailbox,
  summariseCallNotes,
} from "@/modules/vo/crm-actions";

/**
 * AI-01: the Lead page's "Follow-up with Vo" and the consultation record's "Call notes with Vo"
 * controls (`data-vo-crm`). Asking Vo starts a run and the page refreshes to show the draft;
 * Mark as sent, Save, Save to my mailbox and Reject each act only on a person's click, with the
 * text in the box as they edited it. The database decides every one; its refusal is shown.
 */
type Router = { refresh: () => void };
type Result = { ok?: boolean; error?: string; abstained?: boolean; draftId?: string; leftOut?: number } | null | undefined;

const MAX_UPLOAD_BYTES = 200 * 1024;

function field(root: ParentNode, selector: string | undefined): HTMLTextAreaElement | null {
  return selector ? root.querySelector<HTMLTextAreaElement>(selector) : null;
}

function show(result: Result, done: [string, string], router: Router): void {
  if (result && "error" in result && result.error) {
    toast2(result.error, { kind: "warn", sub: "" });
    // A draft already waiting: show it.
    if (result.draftId) router.refresh();
    return;
  }
  if (result?.abstained) {
    toast2("Vo left this for a person", { kind: "warn", sub: "It needs a consultant. Write it yourself." });
    return;
  }
  toast2(done[0], { kind: "ok", sub: done[1] });
  router.refresh();
}

async function readNotesFile(input: HTMLInputElement, root: ParentNode) {
  const file = input.files?.[0];
  const target = field(root, input.dataset.voCrmFile);
  if (!file || !target) return;
  if (!/\.(txt|md)$/i.test(file.name) && !/^text\/(plain|markdown)$/.test(file.type)) {
    toast2("Upload a plain-text file", { kind: "warn", sub: "A .txt or .md file. For anything else, paste the text." });
    input.value = "";
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    toast2("That file is too large", { kind: "warn", sub: "Paste the part of your notes you want summarised." });
    input.value = "";
    return;
  }
  const text = (await file.text()).replace(/\r\n?/g, "\n");
  target.value = text.slice(0, target.maxLength > 0 ? target.maxLength : text.length);
  if (text.length > target.value.length) toast2("Only the first part fits", { kind: "warn", sub: "The notes were cut to the box’s limit. Check the end." });
}

export function bindVoCrmControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "change",
    (event) => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>("input[data-vo-crm-file]");
      if (input && root.contains(input)) void readNotesFile(input, root);
    },
    { signal: listen.signal },
  );
  root.addEventListener(
    "click",
    (event) => {
      const control = (event.target as HTMLElement).closest<HTMLElement>("[data-vo-crm]");
      if (!control || !root.contains(control)) return;
      event.preventDefault();
      event.stopPropagation();
      if (control.getAttribute("aria-busy") === "true") return;
      control.setAttribute("aria-busy", "true");
      void runVoCrmAct(control, root, router).finally(() => control.removeAttribute("aria-busy"));
    },
    { capture: true, signal: listen.signal },
  );
}

export async function runVoCrmAct(control: HTMLElement, root: ParentNode, router: Router) {
  const act = control.dataset.voCrm ?? "";
  const organizationId = control.dataset.org ?? "";
  const draftId = control.dataset.draft ?? "";
  const text = field(root, control.dataset.field)?.value.trim() ?? "";

  if (act === "copy") {
    try {
      await navigator.clipboard.writeText(text);
      toast2("Copied", { kind: "ok", sub: "Paste it into your email or message." });
    } catch {
      toast2("Couldn’t copy", { kind: "warn", sub: "Select the text and copy it yourself." });
    }
    return;
  }
  if (act === "lead-draft") {
    toast2("Vo is drafting", { kind: "info", sub: "This can take a little while." });
    const result = await draftLeadFollowUp({ organizationId, leadId: control.dataset.lead ?? "" });
    return show(result, ["Follow-up drafted", "Review and edit it below. Nothing was sent."], router);
  }
  if (act === "call-draft") {
    if (text.length < 20) return void toast2("Paste your notes first", { kind: "warn", sub: "At least a sentence or two from the call." });
    toast2("Vo is summarising", { kind: "info", sub: "This can take a little while." });
    const result = await summariseCallNotes({ organizationId, bookingId: control.dataset.booking ?? "", notes: text });
    return show(result, ["Summary drafted", "Review and edit it below. Nothing was saved yet."], router);
  }
  if (act === "lead-sent") {
    if (!text) return void toast2("Write the follow-up first", { kind: "warn", sub: "" });
    const result = await markLeadFollowUpSent({ organizationId, draftId, body: text });
    return show(result, ["Marked as sent", "The text you sent is a note on this lead."], router);
  }
  if (act === "call-save") {
    if (!text) return void toast2("Write the summary first", { kind: "warn", sub: "" });
    const result = await saveCallSummary({ organizationId, draftId, body: text });
    return show(result, ["Summary saved", "It’s a staff note now. Clients never see it."], router);
  }
  if (act === "mailbox") {
    const toolkit = control.dataset.toolkit === "outlook" ? "outlook" : "gmail";
    const result = await saveLeadFollowUpToMailbox({ organizationId, draftId, body: text, toolkit });
    if (result && "error" in result) return void toast2(result.error, { kind: "warn", sub: "" });
    toast2("Saved to your mailbox", { kind: "ok", sub: "Open your drafts, send it yourself, then mark it sent here." });
    return;
  }
  if (act === "discard") {
    const result = await discardVoCrmDraft({ organizationId, draftId });
    return show(result, ["Draft rejected", "It stays in Vo’s audit as rejected."], router);
  }
}
