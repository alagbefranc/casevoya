"use client";

import { toast2 } from "@/components/port/kit";
import { sendInboxEmail } from "@/modules/inbox/inbox-reply-actions";
import { parseComposeValue, sentToast } from "@/modules/sheet/inbox-reply-present";

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
