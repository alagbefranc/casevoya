/**
 * Live addition (ADM-04): the banner every staff member sees on every Sheet page while one of
 * Casevoya's service notices (maintenance, incident, information) is current. The Designer has no
 * such banner, so it is built like the subscription banner (SEC-10, `continuity-banner.tsx`) from
 * the Designer's `.alert` with its `.acts`: Notice history and Dismiss. No new classes, no
 * animation. Dismiss hides it for that person only; the notice stays in the history.
 */
import type { ServiceNoticeBannerData } from "@/modules/sheet/service-notices-present";

const SPRITE = "/assets/icons-coreui/sprite.svg";

export function ServiceNoticeBanner({ data }: { data: ServiceNoticeBannerData }) {
  return (
    <div className={`alert ${data.tone}`} role={data.tone === "bad" ? "alert" : "status"} data-service-notice={data.id}>
      <svg className={"ic"} aria-hidden={"true"}>
        <use href={`${SPRITE}#i-${data.icon}`} />
      </svg>
      <div>
        <b>{data.title}</b>
        {data.body}
        {data.more > 0 ? ` ${data.more === 1 ? "1 more notice" : `${data.more} more notices`} in the history.` : null}
      </div>
      <div className={"acts"}>
        <a className={"btn sm"} href={data.href}>
          {"Notice history"}
        </a>
        <button className={"btn sm"} data-notice-dismiss={data.id} data-org={data.organizationId}>
          {"Dismiss"}
        </button>
      </div>
    </div>
  );
}
