/**
 * Live addition (go live; Francis 2026-10-30): the Test mode banner on every staff page and the
 * Go live panel in Settings › Subscription. No Designer screen, so both are built from its parts
 * (`.alert`, `.acts`, `.panel`, `.fp-pad`, `dl.fp-dl`, `.bd`, `.pill`, `.btn`, `.why`, `.dlg`, `.check`).
 * The switches themselves are the client component in go-live-buttons.tsx.
 */
import type { CSSProperties } from "react";
import { Icon } from "./frame";
import { GoLiveButtons } from "./go-live-buttons";
import { GO_LIVE_ANCHOR, type GoLiveBannerData, type GoLivePanelData } from "@/modules/sheet/go-live-present";

const SPRITE = "/assets/icons-coreui/sprite.svg";
export const TEST_DIALOG = "dlgTestMode";

export function GoLiveBanner({ data }: { data: GoLiveBannerData }) {
  return (
    <div className={"alert info"} role={"status"} data-golive-banner={"1"}>
      <svg className={"ic"} aria-hidden={"true"}>
        <use href={`${SPRITE}#i-toggle`} />
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

export function GoLivePanel({ data, index = 0 }: { data: GoLivePanelData; index?: number }) {
  return (
    <section className={"panel rv"} style={{ "--i": String(index) } as CSSProperties} id={GO_LIVE_ANCHOR} aria-labelledby={"goLiveH"} data-golive-panel={data.live ? "live" : "test"}>
      <h2 id={"goLiveH"}>
        <Icon name={"toggle"} />
        {"Go live"}
        <span className={"pill"} style={data.live ? undefined : { background: "var(--tint)", color: "var(--tint-t)" }}>
          {data.badge}
        </span>
      </h2>
      <div className={"fp-pad"}>
        <p style={{ margin: "0 0 12px" }}>{data.intro}</p>
        <dl className={"fp-dl"} aria-label={`Go-live steps, ${data.progress}`}>
          {data.items.map((item) => (
            <div key={item.key} data-golive-item={item.key} data-done={item.done ? "1" : "0"}>
              <dt>{item.title}</dt>
              <dd>
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                  {item.done ? (
                    <span className={"bd ok"}>
                      <i></i>
                      {"Done"}
                    </span>
                  ) : (
                    <span className={"bd unv"}>
                      <i></i>
                      {"To do"}
                    </span>
                  )}
                  {item.done ? null : (
                    <a className={"btn sm"} href={item.href}>
                      {item.go}
                      <Icon name={"arrow-right"} cls={"ic s"} />
                    </a>
                  )}
                </span>
                <small style={{ display: "block", marginTop: "4px", color: "var(--t2)" }}>{item.note}</small>
              </dd>
            </div>
          ))}
        </dl>
        <p className={"why"} style={{ marginTop: "12px" }}>
          <Icon name={"info"} cls={"ic s"} />
          {data.progress}
        </p>
        <details style={{ margin: "10px 0 12px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>{"What happens to test data"}</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: "18px" }}>
            {data.data.map((line) => (
              <li key={line} style={{ marginBottom: "4px" }}>
                {line}
              </li>
            ))}
          </ul>
        </details>
        <GoLiveButtons live={data.live} ready={data.ready} owner={data.owner} why={data.why} dialog={TEST_DIALOG} />
      </div>
    </section>
  );
}

/** The firm owner's confirm before switching back to test mode. */
export function TestModeDialog() {
  return (
    <dialog className={"dlg"} id={TEST_DIALOG} aria-labelledby={"dlgTestModeH"}>
      <div className={"dh"}>
        <h2 id={"dlgTestModeH"}>{"Switch back to test mode"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={TEST_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ margin: "0 0 10px" }}>{"The firm shows the Test mode badge again until you switch it to live once more."}</p>
        <p style={{ margin: "0 0 10px" }}>{"Nothing else changes: clients keep their portal access, matters, documents, invoices and live card payments stay exactly as they are, and nothing is deleted."}</p>
        <label className={"check"}>
          <input type={"checkbox"} id={"tmC"} />
          <span>{"I understand the firm goes back to test mode"}</span>
        </label>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {"Only the firm owner can do this. You’ll confirm it’s you, and it’s recorded in the audit log."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={TEST_DIALOG}>
          {"Stay live"}
        </button>
        <GoLiveButtons live={true} ready={true} owner={true} why={""} dialog={TEST_DIALOG} confirm={true} />
      </div>
    </dialog>
  );
}
