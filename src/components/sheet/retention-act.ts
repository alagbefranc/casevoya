"use client";

import { k2Slider, toast2 } from "@/components/port/kit";
import { saveRetentionPolicy } from "@/modules/settings/retention-actions";
import { RETENTION_DRAFT, retentionStepUpLocation } from "@/modules/settings/retention";
import { needsStepUp } from "@/modules/sheet/matter-wire";

type Router = { refresh: () => void };

function chosenYears(root: ParentNode): number {
  return Number.parseInt(root.querySelector("#retS .v")?.textContent ?? "", 10);
}

/**
 * Settings > Retention (firm owner): the Designer's slider, made draggable with firm setup's own
 * k2Slider. A period chosen before a step-up comes back once, then is forgotten.
 */
export function mountRetentionSlider(root: ParentNode) {
  const slider = root.querySelector<HTMLElement>("#retS");
  const track = slider?.querySelector<HTMLElement>(".k2-sl-tr");
  if (!slider || !track || !root.querySelector("[data-retention-save]")) return;
  const min = Number(track.getAttribute("aria-valuemin"));
  const max = Number(track.getAttribute("aria-valuemax"));
  let value = Number(track.getAttribute("aria-valuenow"));
  try {
    const saved = Number.parseInt(sessionStorage.getItem(RETENTION_DRAFT) ?? "", 10);
    sessionStorage.removeItem(RETENTION_DRAFT);
    if (Number.isInteger(saved) && saved >= min && saved <= max) value = saved;
  } catch {
    // Storage can be unavailable; the slider starts at the saved period.
  }
  k2Slider(slider, { min, max, value, label: "Keep closed files for", unit: "years" });
}

/** Saves the slider's period. A step-up refusal keeps the choice and goes to /mfa, which comes back here. */
export async function runRetentionSave(button: HTMLElement, router: Router) {
  const root = button.closest("#content") ?? document;
  const years = chosenYears(root);
  const result = await saveRetentionPolicy({
    organizationId: button.dataset.org ?? "",
    years,
    expectedVersion: Number(button.dataset.version ?? "-1"),
  });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      try {
        sessionStorage.setItem(RETENTION_DRAFT, String(years));
      } catch {
        // The slider then starts at the saved period after the step-up.
      }
      window.location.assign(retentionStepUpLocation());
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2("Retention period saved", { kind: "ok", sub: `${years} years after closing, version R-${result.version}. Matters already closed keep their period.` });
  router.refresh();
}
