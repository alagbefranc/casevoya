"use client";

/**
 * Live addition (no Designer screen; approved by Francis 2026-10-19): the firm owner's
 * "Switch to live" on the sample-mode page, beside the Designer's "Invite a real client" and
 * built the same way (`.btn p` with a `.why` line under it). Disabled, with what is left
 * listed, while anything blocks real client invitations. public.set_sample_mode(false) decides:
 * it needs the firm owner with a recent step-up and refuses while blockers remain. A step-up
 * refusal goes to /mfa?step=6 through the shared step-up resume (goStepUp): back here, the press
 * is made once more on its own, and never again if that one needs another check.
 */
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { toast2 } from "@/components/port/kit";
import { switchToLive } from "@/modules/sheet/sample-actions";
import { Icon } from "./frame";
import type { GoLiveData } from "./sample-case";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { goStepUp } from "@/lib/auth/step-up-resume";

export function GoLiveSwitch({ data }: { data: GoLiveData }) {
  const router = useRouter();
  // A ref, not state: the click only needs to stop a second call.
  const busy = useRef(false);
  const blocked = data.remaining.length > 0;

  async function run(pressed: HTMLElement) {
    if (blocked || busy.current) return;
    busy.current = true;
    const result = await switchToLive().catch(() => ({ error: "The firm couldn’t be switched to live. Try again.", stepUp: false }));
    busy.current = false;
    if ("error" in result) {
      if (result.stepUp) {
        toast2("Confirm it’s you", { kind: "warn", sub: "Then you come back here to switch to live." });
        const next = `${window.location.pathname}${window.location.search}`;
        window.setTimeout(() => goStepUp(stepUpHref(next, "go_live"), pressed), 900);
        return;
      }
      toast2(result.error, { kind: "bad", sub: "The firm is still in sample mode." });
      return;
    }
    toast2("Your firm is live", { kind: "ok", sub: "Real client invitations are open." });
    router.push("/sheet");
    router.refresh();
  }

  if (!data.owner) {
    return (
      <div data-golive={"switch"}>
        <p className={"why"}>
          <Icon name={"lock"} cls={"ic s"} />
          {blocked ? `Only the firm owner can switch to live. Still to do: ${data.remaining.join("; ")}.` : "Ready: only the firm owner can switch the firm to live."}
        </p>
      </div>
    );
  }
  return (
    <div data-golive={"switch"}>
      <button
        type={"button"}
        className={"btn p"}
        aria-disabled={blocked ? "true" : undefined}
        aria-describedby={"whyLive"}
        onClick={(event) => void run(event.currentTarget)}
      >
        <Icon name={blocked ? "lock" : "check-circle"} cls={"ic s"} />
        {"Switch to live"}
      </button>
      <p className={"why"} id={"whyLive"}>
        {blocked ? <Icon name={"lock"} cls={"ic s"} /> : null}
        {blocked ? `Still to do: ${data.remaining.join("; ")}.` : "Everything is done. Sample records stay marked sample."}
      </p>
    </div>
  );
}
