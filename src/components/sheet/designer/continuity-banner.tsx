/**
 * Live addition (SEC-10): the banner every staff member sees on every Sheet page while the
 * subscription is ending, in its export window, or archived. Built only from the Designer's
 * `.alert` with its `.acts` link, like the Finish setup banner; no new classes, no animation. It
 * cannot be dismissed.
 */
import type { ContinuityBannerData } from "@/modules/sheet/sec-present";

const SPRITE = "/assets/icons-coreui/sprite.svg";

export function ContinuityBanner({ data }: { data: ContinuityBannerData }) {
  return (
    <div className={`alert ${data.tone}`} role={"status"} data-continuity-banner={"1"}>
      <svg className={"ic"} aria-hidden={"true"}>
        <use href={`${SPRITE}#i-${data.tone === "warn" ? "alert" : "archive"}`} />
      </svg>
      <div>
        <b>{data.title}</b>
        {data.body}
      </div>
      {data.href ? (
        <div className={"acts"}>
          <a className={"btn sm"} href={data.href}>
            {"Subscription"}
          </a>
        </div>
      ) : null}
    </div>
  );
}
