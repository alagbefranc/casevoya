"use client";

/**
 * Go live (Francis 2026-10-30): the firm owner's Switch to live and, once live, Switch back to
 * test mode (which opens the confirm dialog; its confirm button is `confirm`). The database
 * decides both: the owner with a recent step-up, every step done to go live, the confirm to go
 * back. A step-up refusal goes to /mfa through the shared resume (goStepUp): Switch to live is
 * pressed once more; the switch-back dialog reopens with its box as it was, to confirm again.
 */
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { toast2 } from "@/components/port/kit";
import { switchFirmToLive, switchFirmToTest } from "@/modules/sheet/go-live-actions";
import { Icon } from "./frame";
import { stepUpHref } from "@/lib/auth/mfa-step";
import { goStepUp } from "@/lib/auth/step-up-resume";

type Props = { live: boolean; ready: boolean; owner: boolean; why: string; dialog: string; confirm?: boolean };

export function GoLiveButtons({ live, ready, owner, why, dialog, confirm = false }: Props) {
  const router = useRouter();
  const busy = useRef(false);

  async function goLive(pressed: HTMLElement) {
    if (!ready || busy.current) return;
    busy.current = true;
    const result = await switchFirmToLive().catch(() => ({ error: "The firm couldn’t be switched. Try again.", stepUp: false }));
    busy.current = false;
    if ("error" in result) {
      if (result.stepUp) {
        toast2("Confirm it’s you", { kind: "warn", sub: "Then you come back here to switch to live." });
        const next = `${window.location.pathname}${window.location.search}`;
        window.setTimeout(() => goStepUp(stepUpHref(next, "go_live"), pressed), 900);
        return;
      }
      toast2(result.error, { kind: "bad", sub: "The firm is still in test mode." });
      router.refresh();
      return;
    }
    toast2("Your firm is live", { kind: "ok", sub: "The Test mode badge is gone. Test records stay labelled test." });
    router.refresh();
  }

  async function backToTest(pressed: HTMLElement) {
    if (busy.current) return;
    const box = pressed.closest("dialog")?.querySelector<HTMLInputElement>("#tmC");
    busy.current = true;
    const result = await switchFirmToTest(Boolean(box?.checked)).catch(() => ({ error: "The firm couldn’t be switched. Try again.", stepUp: false }));
    busy.current = false;
    if ("error" in result) {
      if (result.stepUp) {
        toast2("Confirm it’s you", { kind: "warn", sub: "Then confirm switching back once more." });
        const next = `${window.location.pathname}${window.location.search}`;
        window.setTimeout(() => goStepUp(stepUpHref(next, "test_mode"), pressed), 900);
        return;
      }
      toast2(result.error, { kind: "bad", sub: "The firm is still live." });
      return;
    }
    pressed.closest("dialog")?.close();
    toast2("Back in test mode", { kind: "ok", sub: "Nothing else changed. Switch to live again when you’re ready." });
    router.refresh();
  }

  if (confirm) {
    return (
      <button type={"button"} className={"btn p"} data-golive-act={"test"} onClick={(event) => void backToTest(event.currentTarget)}>
        {"Switch to test mode"}
      </button>
    );
  }
  if (!owner) {
    return (
      <p className={"why"} data-golive={"switch"}>
        <Icon name={"lock"} cls={"ic s"} />
        {why}
      </p>
    );
  }
  if (live) {
    return (
      <div data-golive={"switch"}>
        <button type={"button"} className={"btn sm"} data-dlg={dialog} data-golive-act={"open-test"}>
          {"Switch back to test mode…"}
        </button>
        <p className={"why"}>{why}</p>
      </div>
    );
  }
  return (
    <div data-golive={"switch"}>
      <button
        type={"button"}
        className={"btn p"}
        aria-disabled={ready ? undefined : "true"}
        aria-describedby={"whyGoLive"}
        data-golive-act={"live"}
        onClick={(event) => void goLive(event.currentTarget)}
      >
        <Icon name={ready ? "check-circle" : "lock"} cls={"ic s"} />
        {"Switch to live"}
      </button>
      <p className={"why"} id={"whyGoLive"}>
        {ready ? null : <Icon name={"lock"} cls={"ic s"} />}
        {why}
      </p>
    </div>
  );
}
