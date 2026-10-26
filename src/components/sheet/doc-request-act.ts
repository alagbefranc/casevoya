"use client";

import { goStepUp } from "@/lib/auth/step-up-resume";
import { toast2 } from "@/components/port/kit";
import { createDocumentRequest } from "@/modules/documents/actions";
import { readDocRequest, type DocRequestFields } from "@/modules/sheet/doc-request";
import { needsStepUp, stepUpLocation, withoutDialog } from "@/modules/sheet/matter-wire";

type Router = { replace: (href: string) => void; refresh: () => void };

const DRAFT = "casevoya.docRequest";

function field(root: ParentNode, id: string) {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
}

function readFields(dialog: ParentNode): DocRequestFields {
  return {
    personId: field(dialog, "drqP")?.value ?? "",
    purpose: field(dialog, "drqW")?.value ?? "",
    explanation: field(dialog, "drqE")?.value ?? "",
    dueOn: field(dialog, "drqD")?.value ?? "",
    formats: [...dialog.querySelectorAll<HTMLInputElement>('input[name="drqF"]:checked')].map((box) => box.value),
    sensitivity: field(dialog, "drqS")?.value ?? "",
    audience: field(dialog, "drqA")?.value ?? "",
    criteria: field(dialog, "drqR")?.value ?? "",
  };
}

/** The firm's today, from the due date's `min`; the database decides anyway. */
function today(dialog: ParentNode): string {
  return field(dialog, "drqD")?.getAttribute("min") ?? "";
}

function keepDraft(matterId: string, fields: DocRequestFields) {
  try {
    window.sessionStorage.setItem(DRAFT, JSON.stringify({ matterId, ...fields }));
  } catch {
    // Without storage the person types the request again.
  }
}

/** Back from step-up (`?dlg=request`): put back what was typed before the dialog reopens. */
export function restoreDocRequest(root: HTMLElement) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dReq");
  const button = dialog?.querySelector<HTMLElement>("[data-doc-request]");
  if (!dialog || !button) return;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(DRAFT) ?? "null") as (Partial<DocRequestFields> & { matterId?: string }) | null;
    window.sessionStorage.removeItem(DRAFT);
    if (!saved || saved.matterId !== button.dataset.matter) return;
    const set = (id: string, value: string | undefined) => {
      const node = field(dialog, id);
      if (node && typeof value === "string") node.value = value;
    };
    set("drqP", saved.personId);
    set("drqW", saved.purpose);
    set("drqE", saved.explanation);
    set("drqD", saved.dueOn);
    set("drqS", saved.sensitivity);
    set("drqA", saved.audience);
    set("drqR", saved.criteria);
    if (Array.isArray(saved.formats)) {
      dialog.querySelectorAll<HTMLInputElement>('input[name="drqF"]').forEach((box) => {
        box.checked = saved.formats?.includes(box.value) ?? box.checked;
      });
    }
  } catch {
    // A draft is a convenience; the dialog works without it.
  }
}

/**
 * Send request: createDocumentRequest saves it through public.create_document_request, which
 * checks the role, the step-up, sample mode and that the person is on the matter, then queues
 * the client's "document requested" email (EM06) through the outbox.
 */
export async function runDocRequest(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const organizationId = button.dataset.org ?? "";
  const matterId = button.dataset.matter ?? "";
  const fields = readFields(dialog);
  const read = readDocRequest(fields, today(dialog));
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was sent." });
    return;
  }
  const result = await createDocumentRequest({ organizationId, matterId, ...read.input, code: "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      keepDraft(matterId, fields);
      goStepUp(stepUpLocation(window.location.pathname, window.location.search, "request"));
      return;
    }
    toast2(result.error ?? "The request was not created.", { kind: "bad", sub: "Nothing was sent." });
    return;
  }
  dialog.close();
  dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("#drqW, #drqE, #drqD, #drqR").forEach((node) => {
    node.value = "";
  });
  toast2("Document requested", { kind: "ok", sub: "It’s on the checklist as outstanding. The client sees it in their portal." });
  router.replace(withoutDialog(window.location.pathname, window.location.search));
  router.refresh();
}
