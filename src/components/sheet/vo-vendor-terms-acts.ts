"use client";

import { toast2 } from "@/components/port/kit";
import { acknowledgeVoVendorTerms } from "@/modules/vo/vendor-terms-actions";

type Router = { refresh: () => void };

/** The acknowledgement dialog's button: records the owner's acknowledgement, then turns Vo on when asked. */
export async function runVoTermsAck(button: HTMLElement, router: Router) {
  const turnOn = button.dataset.turnOn === "1";
  const result = await acknowledgeVoVendorTerms({ organizationId: button.dataset.org ?? "", version: button.dataset.voTermsAck ?? "", turnOn });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: turnOn ? "Vo stays off." : "Nothing was changed." });
    return;
  }
  button.closest("dialog")?.close();
  toast2(result.turnedOn ? "AI vendor terms acknowledged, Vo turned on" : "AI vendor terms acknowledged", {
    kind: "ok",
    sub: "The acknowledgement is recorded with who, when and the terms version.",
  });
  router.refresh();
}
