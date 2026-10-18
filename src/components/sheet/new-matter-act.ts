"use client";

import { toast2 } from "@/components/port/kit";
import { createClientMatter } from "@/modules/matters/actions";
import { needsStepUp, newMatterStepUpLocation, readNewMatter } from "@/modules/sheet/new-matter";

type Router = { push: (href: string) => void };

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? "";
}

/**
 * Saves the New matter dialog through the server action. The database decides; a step-up
 * refusal sends the person to /mfa?step=6 and back here with `?new=1`, which reopens the dialog.
 */
export async function runNewMatter(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const read = readNewMatter({
    applicantName: value(dialog, "nmA"),
    applicantEmail: value(dialog, "nmAE"),
    sponsorName: value(dialog, "nmS"),
    sponsorEmail: value(dialog, "nmSE"),
    consultant: value(dialog, "nmC"),
    program: value(dialog, "nmT"),
  });
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const result = await createClientMatter({ organizationId: button.dataset.org ?? "", ...read.input });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      window.location.assign(newMatterStepUpLocation(window.location.pathname, window.location.search));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  toast2(result.reference ? `Matter ${result.reference} created` : "Matter created", { kind: "ok", sub: "Stage: Engagement pending." });
  router.push(`/sheet/matters/${result.id}`);
}
