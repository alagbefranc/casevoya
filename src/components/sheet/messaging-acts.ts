"use client";

import { toast2 } from "@/components/port/kit";
import { approveMessageTemplate, archiveMessageTemplate, saveMessageTemplate, sendAnnouncement } from "@/modules/messages/template-actions";
import { fillTemplate } from "@/modules/messages/templates";
import { plural, rateLimitedMessage } from "@/modules/sheet/announcements-present";

/**
 * OPS-04 act handlers: Inbox > Announcements (New announcement), the New message dialog's "Start
 * from a template", and Templates > Message templates (save, approve, archive). The database
 * decides who may do what; these only ask and say what happened.
 */

type Router = { refresh: () => void; replace: (href: string) => void };

/** The choices in the open dialogs update their previews in place (delegated, so redraws keep working). */
export function mountMessagingInputs(root: HTMLElement, signal: AbortSignal) {
  root.addEventListener(
    "change",
    (event) => {
      const target = event.target as HTMLElement;
      // New announcement: the template's text, and who the audience reaches.
      if (target.id === "anT") {
        const option = (target as HTMLSelectElement).selectedOptions[0];
        const title = root.querySelector<HTMLElement>("#anPt");
        const body = root.querySelector<HTMLElement>("#anPb");
        if (option && title) title.textContent = option.dataset.title ?? "";
        if (option && body) body.textContent = option.dataset.body ?? "";
      }
      if (target.id === "anA") {
        const option = (target as HTMLSelectElement).selectedOptions[0];
        const line = root.querySelector<HTMLElement>("#anL");
        if (option && line) line.textContent = option.dataset.line ?? "";
        const send = root.querySelector<HTMLButtonElement>("[data-ann-send]");
        if (send && send.dataset.canSend !== "0") send.disabled = !Number(option?.dataset.n ?? 0) || !root.querySelector("#anT");
      }
      // New message: "Start from a template" fills the message with what the dialog knows about
      // the chosen person; a field it doesn't know stays as {field} for the sender to fill.
      if (target.id === "nmTp") {
        const dialog = target.closest("dialog");
        const option = (target as HTMLSelectElement).selectedOptions[0];
        const field = dialog?.querySelector<HTMLTextAreaElement>("#nmB");
        const to = dialog?.querySelector<HTMLSelectElement>("#nmT")?.selectedOptions[0];
        const body = option?.dataset.body;
        if (!field || !body) return;
        if (field.value.trim() && !window.confirm("Replace the message with this template?")) return;
        field.value = fillTemplate(body, {
          client_first_name: to?.dataset.first || null,
          matter_reference: to?.dataset.ref || null,
          consultant_name: to?.dataset.consultant || null,
          firm_name: dialog?.querySelector<HTMLElement>("[data-firm]")?.dataset.firm || root.dataset.firm || null,
        });
        field.focus();
      }
      // Message template: the title is for an announcement only.
      if (target.id === "mtU") {
        const titleField = root.querySelector<HTMLElement>("#mtTf");
        if (titleField) titleField.hidden = (target as HTMLSelectElement).value !== "announcement";
      }
    },
    { signal },
  );
}

/** Inbox > Announcements: Send. */
export async function runAnnouncementSend(button: HTMLElement, root: HTMLElement, router: Router) {
  const dialog = button.closest("dialog") ?? root.querySelector<HTMLDialogElement>("#dlgAnn");
  const template = dialog?.querySelector<HTMLSelectElement>("#anT")?.selectedOptions[0];
  const audience = dialog?.querySelector<HTMLSelectElement>("#anA");
  if (!template?.value) {
    toast2("Choose an approved announcement template", { kind: "warn", sub: "Nothing was sent." });
    return;
  }
  const result = await sendAnnouncement({
    organizationId: button.dataset.org ?? "",
    templateId: template.value,
    version: Number(template.dataset.v ?? "0"),
    programKey: audience?.value ? audience.value : null,
  });
  if ("rateLimited" in result) {
    toast2("Not sent yet", { kind: "warn", sub: rateLimitedMessage(result.retryAt, button.dataset.tz || "America/Toronto") });
    return;
  }
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was sent." });
    return;
  }
  (dialog as HTMLDialogElement | null)?.close();
  toast2("Announcement sent", {
    kind: "ok",
    sub: `${plural(result.recipients, "client")} see it on their portal home${result.emailed ? `; ${result.emailed} get a short email` : "; no email was sent"}.`,
  });
  router.refresh();
}

function templateFields(dialog: ParentNode) {
  const useFor = dialog.querySelector<HTMLSelectElement>("#mtU")?.value === "announcement" ? "announcement" : "message";
  return {
    useFor: useFor as "message" | "announcement",
    name: dialog.querySelector<HTMLInputElement>("#mtN")?.value ?? "",
    title: dialog.querySelector<HTMLInputElement>("#mtT")?.value ?? "",
    body: dialog.querySelector<HTMLTextAreaElement>("#mtB")?.value ?? "",
  };
}

/** Templates > Message templates: Save draft (new, or an edit, which needs approving again). */
export async function runTemplateSave(button: HTMLElement, root: HTMLElement, router: Router) {
  const dialog = button.closest("dialog") ?? root;
  const fields = templateFields(dialog);
  if (!fields.name.trim() || !fields.body.trim()) {
    toast2("Give the template a name and text", { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const id = button.dataset.id || null;
  const result = await saveMessageTemplate({
    organizationId: button.dataset.org ?? "",
    templateId: id,
    useFor: fields.useFor,
    name: fields.name,
    title: fields.useFor === "announcement" ? fields.title : null,
    body: fields.body,
    expectedVersion: id ? Number(button.dataset.v ?? "0") : null,
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was saved. Your text is still in the dialog." });
    return;
  }
  (dialog as HTMLDialogElement).close?.();
  toast2("Template saved as a draft", { kind: "ok", sub: "A firm owner or licensed consultant approves it before anyone can use it." });
  router.replace(`/sheet/templates?tab=messages&view=${result.id}`);
  router.refresh();
}

export async function runTemplateApprove(button: HTMLElement, router: Router) {
  const result = await approveMessageTemplate({ organizationId: button.dataset.org ?? "", templateId: button.dataset.id ?? "", version: Number(button.dataset.v ?? "0") });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "It is still a draft." });
    return;
  }
  button.closest("dialog")?.close();
  toast2("Template approved", { kind: "ok", sub: "Staff can use it now." });
  router.replace("/sheet/templates?tab=messages");
  router.refresh();
}

export async function runTemplateArchive(button: HTMLElement, router: Router) {
  if (!window.confirm("Archive this template? Staff can’t use it any more. Messages already sent don’t change.")) return;
  const result = await archiveMessageTemplate({ organizationId: button.dataset.org ?? "", templateId: button.dataset.id ?? "" });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing changed." });
    return;
  }
  button.closest("dialog")?.close();
  toast2("Template archived", { kind: "ok", sub: "" });
  router.replace("/sheet/templates?tab=messages");
  router.refresh();
}
