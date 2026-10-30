/**
 * Live addition (card trial): the firm's Casevoya trial or failed payment, on every staff page.
 * Built only from the Designer's `.alert` with its `.acts` link, like the continuity banner; no
 * new classes. It cannot be dismissed.
 */
import type { BillingBannerData } from "@/modules/sheet/billing-banner";

const SPRITE = "/assets/icons-coreui/sprite.svg";

export function BillingBanner({ data }: { data: BillingBannerData }) {
  return (
    <div className={`alert ${data.tone}`} role={"status"} data-billing-banner={"1"}>
      <svg className={"ic"} aria-hidden={"true"}>
        <use href={`${SPRITE}#i-${data.icon}`} />
      </svg>
      <div>
        <b>{data.title}</b>
        {data.body}
      </div>
      {data.link ? (
        <div className={"acts"}>
          <a className={"btn sm"} href={data.link.href}>
            {data.link.label}
          </a>
        </div>
      ) : null}
    </div>
  );
}
