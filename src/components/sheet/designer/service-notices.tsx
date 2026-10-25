/**
 * Live addition (ADM-04): Settings > Service notices, the firm's history of Casevoya's service
 * notices (current and past, with times in the firm's timezone and the resolution). The Designer
 * has no such screen, so it is built only from its existing pieces, with no new classes and no
 * animation: the page heading (`.ph`), table (`.tw` / `.t`), state badge (`.bd`) and note
 * (`.fp-note`), under the Designer's Settings tab strip with Security selected. The banner is
 * `service-notice-banner.tsx`.
 */
import type { ServiceNoticeHistoryData } from "@/modules/sheet/service-notices-present";
import { Icon } from "./frame";
import { Badge } from "./matters";

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

export function SheetServiceNotices({ data }: { data: ServiceNoticeHistoryData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Service notices"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"tw rv"} role={"region"} aria-label={"Service notices"} tabIndex={0} style={i(1)}>
        <table className={"t"}>
          <caption className={"sr"}>{"Service notices"}</caption>
          <thead>
            <tr>
              <th scope={"col"}>{"Notice"}</th>
              <th scope={"col"}>{"Kind"}</th>
              <th scope={"col"}>{"When"}</th>
              <th scope={"col"}>{"State"}</th>
              <th scope={"col"}>{"Resolution"}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={5}>{data.unavailable ? "Service notices couldn’t be read just now. Reload the page to try again." : "No notices yet. When Casevoya plans maintenance or has an incident affecting your firm, it appears here."}</td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.id} data-notice={row.id}>
                  <td>
                    <b>{row.title}</b>
                    <br />
                    {row.body}
                  </td>
                  <td>{row.kind}</td>
                  <td>{row.when}</td>
                  <td>
                    <Badge badge={row.badge} />
                  </td>
                  <td>{row.resolution}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className={"fp-note rv"} style={{ marginTop: "12px", ...i(2) }}>
        <Icon name={"info"} cls={"ic s"} />
        {` ${data.note}`}
      </p>
    </>
  );
}
