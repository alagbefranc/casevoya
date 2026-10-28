"use client";

import { toast2 } from "@/components/port/kit";
import { sendInboxEmail } from "@/modules/inbox/inbox-reply-actions";
import { addStaffNote, sendMessage } from "@/modules/messages/actions";
import { unfilledNotice } from "@/modules/messages/templates";
import { messageSentToast, parseComposeValue, sentToast } from "@/modules/sheet/inbox-reply-present";

type Router = { refresh: () => void };

function clientKey(): string {
  return `ib-${crypto.randomUUID().replaceAll("-", "")}`;
}

/** The send key stays on the field until it is sent, so a double click or retry sends once. */
function keyFor(field: HTMLElement): string {
  const key = field.dataset.sendKey || clientKey();
  field.dataset.sendKey = key;
  return key;
}

/** A conversation's "Send to …": the reply box's text, by email, to the thread's person. */
export async function runInboxReply(button: HTMLElement, root: HTMLElement, router: Router) {
  const data = button.dataset;
  const field = root.querySelector<HTMLTextAreaElement>("#rp");
  const body = field?.value ?? "";
  if (!field || !body.trim()) {
    toast2("Write a reply first", { kind: "warn", sub: "Nothing was sent." });
    field?.focus();
    return;
  }
  const result = await sendInboxEmail({
    organizationId: data.org ?? "",
    matterId: data.matter ?? "",
    personId: data.person ?? "",
    body,
    replyToEmailId: data.inboxReply && data.inboxReply !== "new" ? data.inboxReply : null,
    clientKey: keyFor(field),
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was sent. Your text is still in the box." });
    return;
  }
  field.value = "";
  delete field.dataset.sendKey;
  const done = sentToast(data.name || "the client", result.sample);
  toast2(done.title, { kind: done.kind, sub: done.sub });
  router.refresh();
}

/**
 * A conversation whose latest message came through the portal or WhatsApp: "Send to …" replies in
 * that matter thread (a staff message the client reads in their portal), with "Ask … to
 * acknowledge" when ticked. The database decides who may write and to whom.
 */
export async function runInboxMessage(button: HTMLElement, root: HTMLElement, router: Router) {
  const data = button.dataset;
  const field = root.querySelector<HTMLTextAreaElement>("#rp");
  const body = field?.value ?? "";
  if (!field || !body.trim()) {
    toast2("Write a reply first", { kind: "warn", sub: "Nothing was sent." });
    field?.focus();
    return;
  }
  const ack = Boolean(root.querySelector<HTMLInputElement>("#rpAck")?.checked);
  const result = await sendMessage({
    organizationId: data.org ?? "",
    matterId: data.matter ?? "",
    threadId: data.inboxMessage ?? "",
    body,
    requiresAck: ack,
    clientKey: keyFor(field),
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was sent. Your text is still in the box." });
    return;
  }
  field.value = "";
  delete field.dataset.sendKey;
  const ackBox = root.querySelector<HTMLInputElement>("#rpAck");
  if (ackBox) ackBox.checked = false;
  const done = messageSentToast(data.name || "the client", ack);
  toast2(done.title, { kind: done.kind, sub: done.sub });
  router.refresh();
}

/** "Staff-only note": the reply box's text, kept on the matter for staff only. Never shown to the client or mailed. */
export async function runInboxNote(button: HTMLElement, root: HTMLElement, router: Router) {
  const field = root.querySelector<HTMLTextAreaElement>("#rp");
  const body = field?.value ?? "";
  if (!field || !body.trim()) {
    toast2("Write the note in the reply box first", { kind: "warn", sub: "Nothing was saved." });
    field?.focus();
    return;
  }
  const result = await addStaffNote({ organizationId: button.dataset.org ?? "", matterId: button.dataset.inboxNote ?? "", body });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was saved. Your text is still in the box." });
    return;
  }
  field.value = "";
  delete field.dataset.sendKey;
  toast2("Staff-only note saved", { kind: "ok", sub: "It is on the matter’s notes. The client never sees it." });
  router.refresh();
}

/** The New message dialog's Send: the chosen person on the chosen matter, by email. */
export async function runInboxCompose(button: HTMLElement, root: HTMLElement, router: Router) {
  const dialog = button.closest("dialog") ?? root.querySelector<HTMLDialogElement>("#dlgMsg");
  const select = dialog?.querySelector<HTMLSelectElement>("#nmT") ?? null;
  const field = dialog?.querySelector<HTMLTextAreaElement>("#nmB") ?? null;
  const target = parseComposeValue(select?.value);
  if (!target) {
    toast2("Choose who to write to", { kind: "warn", sub: "Nothing was sent." });
    return;
  }
  const body = field?.value ?? "";
  if (!field || !body.trim()) {
    toast2("Write a message first", { kind: "warn", sub: "Nothing was sent." });
    field?.focus();
    return;
  }
  // OPS-04: a template field nobody filled is a gap, not something to send.
  const gap = unfilledNotice(body);
  if (gap) {
    toast2(gap, { kind: "warn", sub: "Nothing was sent." });
    field.focus();
    return;
  }
  const result = await sendInboxEmail({
    organizationId: button.dataset.org ?? "",
    matterId: target.matterId,
    personId: target.personId,
    body,
    clientKey: keyFor(field),
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was sent. Your message is still in the dialog." });
    return;
  }
  field.value = "";
  delete field.dataset.sendKey;
  (dialog as HTMLDialogElement | null)?.close();
  // The option reads "Name <separator> Matter"; in the page the separator leaves two spaces.
  const name = (select?.selectedOptions[0]?.textContent ?? "").trim().split(/\s{2,}/)[0].trim().split(/\s+/)[0] || "the client";
  const done = sentToast(name, result.sample);
  toast2(done.title, { kind: done.kind, sub: done.sub });
  router.refresh();
}
