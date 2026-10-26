/**
 * Live additions (DES-04): the Sheet's shared incomplete and failed states, built only from the
 * Designer's own parts on its System states reference sheet (`markup/states.tsx`):
 *   - NoAccessPanel: the "No permission" panel (Vo holding a lock, the reason in `b`, who to ask in
 *     `small`, one `btn s sm`). Used wherever a role can't open a page or a tab, in place of a
 *     blank table.
 *   - StateAlert: the Designer's `.alert` banner with its `.acts` (as the Finish setup and service
 *     notice banners), for a stale official source (`warn`, clock), a partial read (`info`, or
 *     `bad` when a read failed) and a failed payment (`bad`).
 * No new classes, no animation. The words come from `modules/sheet/states-present.ts`.
 */
import type { NoAccessData, StateAlertData } from "@/modules/sheet/states-present";

const SPRITE = "/assets/icons-coreui/sprite.svg";

/** The Designer's Vo holding a lock ("No permission"), as captured. */
function LockMascot() {
  return (
    <svg className={"mascot vo-pose p-lock"} width={64} height={64} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo holding a lock, private"} style={{ overflow: "visible" }}>
      <g className={"m-body"} style={{ transformOrigin: "50px 90px" }} transform={""}>
        <path d={"M38 20 C 42 28, 46 32, 50 31 C 55 26, 60 18, 68 14"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
        <ellipse cx={"50"} cy={"60"} rx={"32"} ry={"30"} fill={"#0075DE"} />
        <ellipse cx={"50"} cy={"64"} rx={"21"} ry={"17"} fill={"#fff"} />
        <ellipse cx={"42"} cy={"60"} rx={"3.4"} ry={"3.9"} fill={"#111"} />
        <ellipse cx={"58"} cy={"60"} rx={"3.4"} ry={"3.9"} fill={"#111"} />
        <circle cx={"43.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
        <circle cx={"59.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
        <path d={"M45 70 q5 4 10 0"} fill={"none"} stroke={"#111"} strokeWidth={"2.2"} strokeLinecap={"round"} />
        <ellipse cx={"34"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
        <ellipse cx={"66"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
      </g>
      <rect x={"66"} y={"70"} width={26} height={22} rx={"5"} fill={"#ffb110"} />
      <path d={"M71 70v-6a8 8 0 0 1 16 0v6"} fill={"none"} stroke={"#111"} strokeWidth={"3"} />
      <circle cx={"79"} cy={"80"} r={"2.6"} fill={"#111"} />
    </svg>
  );
}

/** Permission denied: the Designer's "No permission" panel, with what's missing and who to ask. */
export function NoAccessPanel({ data, n = 1 }: { data: NoAccessData; n?: number }) {
  return (
    <div className={"panel rv"} style={{ "--i": String(n) } as React.CSSProperties} data-no-access={"1"}>
      <div className={"pad"} style={{ minHeight: "150px" }}>
        <div style={{ textAlign: "center", paddingTop: "10px" }} role={"status"}>
          <LockMascot />
          <p style={{ margin: "10px 0" }}>
            <b style={{ fontWeight: "500" }}>{data.title}</b>
            <br />
            <small style={{ color: "var(--t2)" }}>{data.role ? `${data.copy} ${data.role}` : data.copy}</small>
          </p>
          {data.action ? (
            <a className={"btn s sm"} href={data.action.href}>
              {data.action.label}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** A stale-source, partial or failed-payment banner at the top of the page's content. */
export function StateAlert({ data }: { data: StateAlertData }) {
  return (
    <div className={`alert ${data.tone}`} role={data.tone === "bad" ? "alert" : "status"} data-state={data.kind}>
      <svg className={"ic"} aria-hidden={"true"}>
        <use href={`${SPRITE}#i-${data.icon}`} />
      </svg>
      <div>
        <b>{data.title}</b>
        {data.body}
        {data.items.length ? (
          <ul style={{ margin: "6px 0 0 18px", fontSize: "13.5px" }}>
            {data.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {data.action ? (
        <div className={"acts"}>
          <a className={"btn sm"} href={data.action.href}>
            {data.action.label}
          </a>
        </div>
      ) : null}
    </div>
  );
}

/** Several banners in order, skipping the empty ones. */
export function StateAlerts({ items }: { items: readonly (StateAlertData | null | undefined)[] }) {
  const shown = items.filter((item): item is StateAlertData => Boolean(item));
  if (!shown.length) return null;
  return (
    <>
      {shown.map((item) => (
        <StateAlert key={`${item.kind}-${item.title}`} data={item} />
      ))}
    </>
  );
}
