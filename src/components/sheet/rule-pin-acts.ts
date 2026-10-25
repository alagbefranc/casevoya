"use client";

import { toast2 } from "@/components/port/kit";
import { decideRuleUpgrade } from "@/modules/matters/rule-pin-actions";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

type Router = { refresh: () => void };

/**
 * SRC-05: Accept upgrade and Decline in the Overview's Review upgrade dialog (`data-pin`). The
 * database decides (role, step-up for an accept, matter version, newer approved pack) and audits
 * the decision. A step-up refusal sends the person to /mfa?step=6 and back to the matter.
 */
export function bindRulePinControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "click",
    (event) => {
      const control = (event.target as HTMLElement).closest<HTMLElement>("[data-pin]");
      if (!control || !root.contains(control)) return;
      event.preventDefault();
      event.stopPropagation();
      if (control.getAttribute("aria-busy") === "true") return;
      control.setAttribute("aria-busy", "true");
      void runRulePinAct(control, router).finally(() => control.removeAttribute("aria-busy"));
    },
    { capture: true, signal: listen.signal },
  );
}

export async function runRulePinAct(control: HTMLElement, router: Router) {
  const act = control.dataset.pin;
  if (act !== "accept" && act !== "decline") return;
  const dialog = control.closest("dialog");
  const reason = (dialog?.querySelector<HTMLTextAreaElement>("#pinWhy")?.value ?? "").trim();
  if (reason.length < 3) {
    toast2("Say why", { kind: "warn", sub: "Kept with the decision in the audit log. Nothing was saved." });
    return;
  }
  const result = await decideRuleUpgrade({
    organizationId: control.dataset.org ?? "",
    matterId: control.dataset.matter ?? "",
    packId: control.dataset.pack ?? "",
    version: Number(control.dataset.version),
    decision: act === "accept" ? "accepted" : "declined",
    reason,
  });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null, "matter_change"));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog?.close();
  toast2(act === "accept" ? "Rule pack upgraded" : "Upgrade declined", {
    kind: "ok",
    sub: act === "accept" ? "The matter now uses the new version. Earlier exports and packages keep theirs." : "The matter stays on its pinned version. Recorded in the audit log.",
  });
  router.refresh();
}
