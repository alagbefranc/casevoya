"use client";

import { toast2 } from "@/components/port/kit";
import { PERSON_EDIT_DIALOG } from "@/components/sheet/designer/person-edit";
import { savePersonDetails } from "@/modules/sheet/actions";
import { readPersonEdit } from "@/modules/sheet/edit-person";
import { needsStepUp } from "@/modules/sheet/matter-wire";
import { openPortalInvite } from "./portal-invite-act";

type Router = { refresh: () => void };

function input(root: ParentNode, id: string): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>(`#${id}`);
}

/** Opens Edit details for the person whose button was clicked, filled from its `data-*`. */
export function openPersonEdit(button: HTMLElement, root: HTMLElement) {
  const dialog = root.querySelector<HTMLDialogElement>(`#${PERSON_EDIT_DIALOG}`);
  if (!dialog) return;
  const data = button.dataset;
  dialog.dataset.org = data.org ?? "";
  dialog.dataset.person = data.person ?? "";
  dialog.dataset.version = data.version ?? "";
  const fill: [string, string | undefined][] = [
    ["peN", data.name],
    ["peE", data.email],
    ["peP", data.phone],
    ["peD", data.birth],
  ];
  for (const [id, value] of fill) {
    const field = input(dialog, id);
    if (field) field.value = value ?? "";
  }
  const hint = dialog.querySelector<HTMLElement>("#peD-h");
  if (hint && data.birthHint) hint.textContent = data.birthHint;
  // On the matter page, someone who can be invited (the opener carries their portal role) is offered the invitation too.
  const invite = dialog.querySelector<HTMLElement>("[data-edit-invite]");
  if (invite) invite.hidden = !data.role;
  if (!dialog.open) dialog.showModal();
}

/** "Invite to the portal" in Edit details: the invitation for the same person, from their card's Manage button. */
export function inviteFromEdit(button: HTMLElement, root: HTMLElement) {
  const dialog = button.closest("dialog");
  const person = dialog?.dataset.person ?? "";
  const opener = [...root.querySelectorAll<HTMLElement>("[data-edit-open][data-role]")].find((item) => item.dataset.person === person);
  if (!opener) return;
  dialog?.close();
  openPortalInvite(opener, root);
}

/** Saves Edit details through the server action. Row-level security decides; nothing is saved on a refusal. */
export async function runPersonEdit(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const fields = {
    organizationId: dialog.dataset.org ?? "",
    personId: dialog.dataset.person ?? "",
    version: dialog.dataset.version ?? "",
    name: input(dialog, "peN")?.value ?? "",
    email: input(dialog, "peE")?.value ?? "",
    phone: input(dialog, "peP")?.value ?? "",
    dateOfBirth: input(dialog, "peD")?.value ?? "",
  };
  // Checked here for a quick answer, and again by the server action and the database.
  const read = readPersonEdit(fields);
  if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
  const result = await savePersonDetails(fields);
  if ("error" in result) {
    toast2(result.error, {
      kind: "bad",
      sub: needsStepUp(result.error)
        ? "Sign in again with your authenticator, then retry. Nothing was saved."
        : /nothing was saved/i.test(result.error)
          ? ""
          : "Nothing was saved.",
    });
    return;
  }
  dialog.close();
  if (result.unchanged) return void toast2("No changes to save", { kind: "ok", sub: "Their details are as they were." });
  toast2("Details saved", { kind: "ok", sub: ["Recorded in the firm’s audit log.", ...result.notes].join(" "), duration: result.notes.length ? 12000 : undefined });
  router.refresh();
}
