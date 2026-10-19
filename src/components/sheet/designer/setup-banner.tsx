"use client";

/**
 * Live addition (no Designer screen; approved by Francis 2026-10-19): the Finish setup banner a
 * sample-mode firm sees on every staff Sheet page. Built only from the Designer's `.alert warn`
 * with its `.acts` buttons (as on Finance > Payments' "1 bank payment to verify"); no new
 * classes, no animation. It cannot be dismissed: "Hide details" only shortens it to its first
 * line for this browser session (a session cookie), and the Finish setup link stays.
 */
import { useState } from "react";
import { SETUP_BANNER_COOKIE, type SetupBannerData } from "@/modules/sheet/setup-present";

const SPRITE = "/assets/icons-coreui/sprite.svg";

function remember(collapsed: boolean) {
  try {
    // No Max-Age or Expires: a session cookie, gone when the browser closes.
    document.cookie = collapsed ? `${SETUP_BANNER_COOKIE}=collapsed; Path=/; SameSite=Lax` : `${SETUP_BANNER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch {
    // Cookies can be blocked; the banner then opens in full on the next page.
  }
}

export function SetupBanner({ data }: { data: SetupBannerData }) {
  const [collapsed, setCollapsed] = useState(data.collapsed);
  return (
    <div className={"alert warn"} role={"status"} data-setup-banner={"1"}>
      <svg className={"ic"} aria-hidden={"true"}>
        <use href={`${SPRITE}#i-info`} />
      </svg>
      <div>
        <b>{`${data.firmName} is in sample mode`}</b>
        <span id={"setupMore"} hidden={collapsed}>
          {"Practice data only: everyone here is fictional, and real clients can’t be invited until setup is finished. "}
          {data.progress}
        </span>
      </div>
      <div className={"acts"}>
        <a className={"btn p sm"} href={"/sheet/sample-mode"}>
          {"Finish setup"}
        </a>
        <button
          type={"button"}
          className={"btn sm"}
          aria-expanded={!collapsed}
          aria-controls={"setupMore"}
          onClick={() => {
            remember(!collapsed);
            setCollapsed(!collapsed);
          }}
        >
          {collapsed ? "Show details" : "Hide details"}
        </button>
      </div>
    </div>
  );
}
