"use client";

import { toast2 } from "@/components/port/kit";
import { setDocumentUploadLimit } from "@/modules/documents/actions";
import { UPLOAD_LIMIT_DIALOG } from "@/modules/sheet/settings-present";

type Router = { refresh: () => void };

/** Settings > Security, Change limit (DOC-02): public.set_document_upload_limit checks the owner, the step-up and the ceiling. */
export async function runUploadLimit(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const mb = Number(dialog.querySelector<HTMLInputElement>("#ulMb")?.value ?? "");
  const max = Number(button.dataset.max ?? "25");
  if (!Number.isInteger(mb) || mb < 1 || mb > max) {
    toast2(`Choose a whole number from 1 to ${max} MB.`, { kind: "bad", sub: "The limit didn’t change." });
    return;
  }
  const code = dialog.querySelector<HTMLInputElement>("#ulC")?.value.trim() ?? "";
  if (!/^\d{6}$/.test(code)) {
    toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "The limit didn’t change." });
    return;
  }
  const result = await setDocumentUploadLimit({ organizationId: button.dataset.org ?? "", bytes: mb * 1024 * 1024, code });
  if ("error" in result) {
    toast2(result.error ?? "The limit didn’t change.", { kind: "bad", sub: "The limit didn’t change." });
    return;
  }
  (document.getElementById(UPLOAD_LIMIT_DIALOG) as HTMLDialogElement | null)?.close();
  toast2(`Upload limit set to ${mb} MB`, { kind: "ok", sub: "Every new upload is checked against it. It’s in the audit trail." });
  router.refresh();
}
