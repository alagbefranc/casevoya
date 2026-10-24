"use client";

import { toast2 } from "@/components/port/kit";
import { withoutDialog } from "@/modules/sheet/matter-wire";
import { closeFirmTransfer, recordFirmTransfer, reviewTransferAuthority, type TransferResult } from "@/modules/settings/firm-transfer-actions";
import { TRANSFER_CLOSE_DIALOG, TRANSFER_REVIEW_DIALOG } from "@/modules/sheet/firm-transfers-present";

/**
 * Settings > Team and seats, firm transfers (ORG-06): Record a firm transfer, Review client
 * authority and Close transfer. The database decides; a step-up refusal sends the owner to confirm
 * it's them and back to this tab.
 */
type Router = { refresh: () => void; replace: (href: string) => void };

function value(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value ?? "").trim();
}

/** The row's Review authority / Close transfer buttons tell their dialog which item or transfer. */
export function prepareTransferDialog(opener: HTMLElement, root: ParentNode) {
  const item = opener.dataset.xferItem;
  if (item) {
    const dialog = root.querySelector<HTMLDialogElement>(`dialog#${TRANSFER_REVIEW_DIALOG}`);
    if (!dialog) return;
    dialog.dataset.item = item;
    const label = dialog.querySelector("[data-xfer-label]");
    if (label) label.textContent = opener.dataset.xferMatter ?? "";
    dialog.querySelectorAll<HTMLInputElement>("input[name=xfA]").forEach((radio) => (radio.checked = false));
    const note = dialog.querySelector<HTMLTextAreaElement>("#xfRN");
    if (note) note.value = "";
  }
  const transfer = opener.dataset.xferClose;
  if (transfer) {
    const dialog = root.querySelector<HTMLDialogElement>(`dialog#${TRANSFER_CLOSE_DIALOG}`);
    if (!dialog) return;
    dialog.dataset.transfer = transfer;
    const complete = dialog.querySelector<HTMLOptionElement>("#xfS option[value=completed]");
    const ready = opener.dataset.xferComplete === "1";
    if (complete) complete.disabled = !ready;
    const select = dialog.querySelector<HTMLSelectElement>("#xfS");
    if (select) select.value = ready ? "completed" : "cancelled";
  }
}

const DONE = {
  record: { title: "Transfer recorded", sub: "Nothing has moved. Review each client’s authority and make their exports." },
  review: { title: "Authority review saved", sub: "Recorded with the transfer and in the audit log." },
  close: { title: "Transfer closed", sub: "Recorded in the audit log." },
} as const;

export async function runFirmTransferAct(button: HTMLElement, router: Router) {
  const act = button.dataset.xferAct as keyof typeof DONE | undefined;
  const dialog = button.closest("dialog");
  if (!act || !dialog || !(act in DONE)) return;
  const organizationId = button.dataset.org ?? "";
  let result: TransferResult;
  if (act === "record") {
    const matterIds = [...dialog.querySelectorAll<HTMLInputElement>("input[name=xfM]:checked")].map((input) => input.value);
    result = await recordFirmTransfer({ organizationId, firm: value(dialog, "#xfF"), contactName: value(dialog, "#xfC"), contactEmail: value(dialog, "#xfE"), note: value(dialog, "#xfN"), matterIds });
  } else if (act === "review") {
    const choice = dialog.querySelector<HTMLInputElement>("input[name=xfA]:checked")?.value;
    result = await reviewTransferAuthority({ organizationId, itemId: dialog.dataset.item ?? "", authorised: choice === "yes" ? true : choice === "no" ? false : null, note: value(dialog, "#xfRN") });
  } else {
    result = await closeFirmTransfer({ organizationId, transferId: dialog.dataset.transfer ?? "", status: value(dialog, "#xfS"), note: value(dialog, "#xfCN") });
  }
  if ("error" in result) {
    if (result.stepUp) {
      toast2("Confirm it’s you", { kind: "warn", sub: "Then come back and save again." });
      const next = `${window.location.pathname}${window.location.search}`;
      window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(next)}`), 900);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  dialog.close();
  toast2(DONE[act].title, { kind: "ok", sub: DONE[act].sub });
  router.replace(withoutDialog(window.location.pathname, window.location.search));
  router.refresh();
}
