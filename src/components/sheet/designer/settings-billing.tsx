/**
 * Settings > Subscription and Settings > Retention, ported from the Designer's Settings page
 * (`SettingsMarkup` variants "tab-billing" and "tab-retention"): the same top bar with its two
 * pills, the Designer's own tab row, `.ph`, `section.panel` with `.fp-pad` / `dl.fp-dl`, the
 * Retention `.k2-sl` slider and the `.fp-note`. Data comes from settings-billing-present.
 *
 * Live-only additions, built from the Designer's own parts: an `.alert` above the panel when there
 * is something to act on, a `.fp-note` under the Subscription panel, and (firm owner only) a
 * `.fp-row` Save button under the Retention policy carrying `data-retention-save`, `data-org` and
 * `data-version` so use-sheet saves through public.set_firm_retention_policy.
 */
import { Fragment } from "react";
import { Icon, Sep } from "./frame";
import { SETTINGS_TABS } from "./portal-policies";

/** The Designer's Settings tab row: its eleven tabs, in its order (Client portal is a live-only page). */
export const BILLING_SETTINGS_TABS = SETTINGS_TABS.filter(([key]) => key !== "portal");

export type SettingsBillingTab = "billing" | "retention";

/** Where the Designer's script left the underline on each tab (use-sheet places it again on load). */
const UNDERLINE: Record<SettingsBillingTab, { left: string; width: string }> = {
  billing: { left: "317px", width: "73px" },
  retention: { left: "416px", width: "56px" },
};

export type SettingsBillingAlert = { tone: "warn" | "info"; icon: string; title: string; body: string };

export type SubscriptionData = {
  /** "What {payer} pays Casevoya." */
  payer: string;
  rows: [string, string][];
  alert: SettingsBillingAlert | null;
  note: string | null;
};

/** A definition whose parts the Designer separates with its thin `.sep`. */
export type RetentionRow = [string, string[]];

export type RetentionData = {
  intro: string;
  slider: { value: number; min: number; max: number };
  rows: RetentionRow[];
  note: string;
  alert: SettingsBillingAlert | null;
  /** Firm owner only: what the Save button sends. */
  save: { organizationId: string; version: number } | null;
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** The Designer's Settings top bar (firm and plan pills) and tab row, with `tab` selected. */
export function SettingsBillingHeader({ firmName, pill, tab }: { firmName: string; pill: string; tab: SettingsBillingTab }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {"Settings"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"pill"}>{firmName}</span>
        <span className={"pill"}>{pill}</span>
        <span className={"acts"}></span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {BILLING_SETTINGS_TABS.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[tab]}></i>
      </div>
    </>
  );
}

function Alert({ alert, index }: { alert: SettingsBillingAlert; index: number }) {
  return (
    <div className={`alert ${alert.tone} rv`} style={i(index)} role={"status"}>
      <Icon name={alert.icon} />
      <div>
        <b>{alert.title}</b>
        {alert.body}
      </div>
    </div>
  );
}

export function SheetSubscription({ data }: { data: SubscriptionData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Subscription"}</h1>
          <p>{`What ${data.payer} pays Casevoya. This is separate from any client’s money and never comes out of a client account.`}</p>
        </div>
      </div>
      {data.alert ? <Alert alert={data.alert} index={1} /> : null}
      <section className={"panel rv"} style={i(1)}>
        <h2>
          <Icon name={"credit-card"} />
          {"Plan"}
        </h2>
        <div className={"fp-pad"}>
          <dl className={"fp-dl"}>
            {data.rows.map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      {data.note ? (
        <p className={"fp-note rv"} style={i(2)}>
          <Icon name={"info"} cls={"ic s"} />
          {` ${data.note}`}
        </p>
      ) : null}
    </>
  );
}

/** `parts` joined by the Designer's separator: "R-2 · approved by …". */
function Parts({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <Sep /> : null}
          {`${index > 0 ? " " : ""}${part}${index < parts.length - 1 ? " " : ""}`}
        </Fragment>
      ))}
    </>
  );
}

/** "66.6667": the slider position as the browser writes it back into the style. */
function percent(value: number, min: number, max: number): string {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return `${Number(pct.toPrecision(6))}%`;
}

export function RetentionSlider({ slider }: { slider: RetentionData["slider"] }) {
  const at = percent(slider.value, slider.min, slider.max);
  return (
    <div id={"retS"} className={"k2-sl"}>
      <div className={"k2-sl-top"}>
        <span>{"Keep closed files for"}</span>
        <b className={"num"}>
          <span className={"v"}>{String(slider.value)}</span>
          {" years"}
        </b>
      </div>
      <div className={"k2-sl-body"}>
        <span className={"k2-sl-cap"}>{String(slider.min)}</span>
        <div
          className={"k2-sl-tr"}
          role={"slider"}
          tabIndex={0}
          aria-label={"Keep closed files for"}
          aria-valuemin={slider.min}
          aria-valuemax={slider.max}
          aria-valuenow={slider.value}
          aria-valuetext={`${slider.value} years`}
        >
          <i className={"k2-sl-fill"} style={{ width: at }}></i>
          <i className={"k2-sl-th"} style={{ left: at }}></i>
        </div>
        <span className={"k2-sl-cap"}>{String(slider.max)}</span>
      </div>
    </div>
  );
}

export function SheetRetention({ data }: { data: RetentionData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Retention"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      {data.alert ? <Alert alert={data.alert} index={1} /> : null}
      <section className={"panel rv"} style={i(1)}>
        <h2>
          <Icon name={"archive"} />
          {"Policy"}
        </h2>
        <div className={"fp-pad"}>
          <RetentionSlider slider={data.slider} />
          <dl className={"fp-dl"}>
            {data.rows.map(([term, parts]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>
                  <Parts parts={parts} />
                </dd>
              </div>
            ))}
          </dl>
          {data.save ? (
            <div className={"fp-row"} style={{ marginTop: "12px" }}>
              <button className={"btn p sm"} data-retention-save={""} data-org={data.save.organizationId} data-version={String(data.save.version)}>
                {"Save retention period"}
              </button>
            </div>
          ) : null}
        </div>
      </section>
      <p className={"fp-note rv"} style={i(2)}>
        {data.note}
      </p>
    </>
  );
}
