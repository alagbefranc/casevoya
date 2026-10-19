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

/** One Casevoya invoice line: "CV-0007 · 19 Oct 2026 · CAD 349 · Paid" with Stripe's hosted page or PDF. */
export type SubscriptionInvoiceRow = { text: string; href: string | null };

/** A live-only button under the Plan rows (firm owner): opens the plan dialog, or the Billing Portal. */
export type SubscriptionButton = { label: string; act: "plan" | "portal"; primary: boolean; organizationId: string };

export type PlanDialogData = {
  organizationId: string;
  currency: string;
  annualMonths: number;
  extraSeatMonthlyCents: number | null;
  plans: { value: string; label: string; monthlyCents: number | null; yearlyCents: number | null; allowances: string }[];
  selected: string;
  interval: "month" | "year";
  extraSeats: number;
};

export type SubscriptionData = {
  /** "What {payer} pays Casevoya." */
  payer: string;
  rows: [string, string][];
  alert: SettingsBillingAlert | null;
  note: string | null;
  /** Live-only: Casevoya's invoices, listed in the "Invoices from Casevoya" row. */
  invoices?: SubscriptionInvoiceRow[];
  /** Live-only, firm owner: the `.fp-row` of buttons under the rows. */
  buttons?: SubscriptionButton[];
  /** Live-only, firm owner: the Choose a plan dialog (#dlgPlan), rendered after the frame. */
  dialog?: PlanDialogData | null;
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

const INVOICES_ROW = "Invoices from Casevoya";

/** The invoice lines inside the "Invoices from Casevoya" dd, each with its Download link, separated by the Designer's `.sep`. */
function InvoiceLines({ invoices }: { invoices: SubscriptionInvoiceRow[] }) {
  return (
    <>
      {invoices.map((inv, index) => (
        <Fragment key={index}>
          {index > 0 ? <Sep /> : null}
          {`${index > 0 ? " " : ""}${inv.text} `}
          {inv.href ? (
            <a href={inv.href} target={"_blank"} rel={"noreferrer"}>
              {"Download"}
            </a>
          ) : (
            "No file yet"
          )}
        </Fragment>
      ))}
    </>
  );
}

export function SheetSubscription({ data }: { data: SubscriptionData }) {
  const invoices = data.invoices ?? [];
  const buttons = data.buttons ?? [];
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
                <dd>{term === INVOICES_ROW && invoices.length ? <InvoiceLines invoices={invoices} /> : value}</dd>
              </div>
            ))}
          </dl>
          {buttons.length ? (
            <div className={"fp-row"} style={{ marginTop: "12px" }}>
              {buttons.map((button) => (
                <button key={button.label} className={button.primary ? "btn p sm" : "btn sm"} data-subscription-act={button.act} data-org={button.organizationId}>
                  {button.label}
                </button>
              ))}
            </div>
          ) : null}
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

function cents(value: number | null, currency: string, per: string): string {
  if (value === null) return "no price set";
  const whole = value % 100 === 0;
  return `${currency} ${(value / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}/${per}`;
}

/**
 * Choose a plan (#dlgPlan): a live addition from the Designer's dialog parts (`.dlg`, `.dh`, `.db`,
 * `.fld`, `.sel`, `.inp`, `.seg`, `.why`, `.df`). The catalog rides on data attributes so the
 * browser recomputes the total; the server checks it all again.
 */
export function PlanDialog({ data }: { data: PlanDialogData }) {
  return (
    <dialog
      className={"dlg"}
      id={"dlgPlan"}
      aria-labelledby={"dlgPlanH"}
      data-org={data.organizationId}
      data-currency={data.currency}
      data-annual-months={String(data.annualMonths)}
      data-seat-cents={data.extraSeatMonthlyCents === null ? undefined : String(data.extraSeatMonthlyCents)}
    >
      <div className={"dh"}>
        <h2 id={"dlgPlanH"}>{"Choose a plan"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgPlan"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"plI"}>{"Billing"}</label>
          <div className={"seg"} id={"plI"} role={"group"} aria-label={"Billing interval"}>
            <button type={"button"} data-interval={"month"} aria-pressed={data.interval === "month" ? "true" : "false"}>
              {"Monthly"}
            </button>
            <button type={"button"} data-interval={"year"} aria-pressed={data.interval === "year" ? "true" : "false"}>
              {`Annual (${data.annualMonths} months)`}
            </button>
          </div>
        </div>
        <div className={"fld"}>
          <label htmlFor={"plS"}>{"Plan"}</label>
          <select className={"sel"} id={"plS"} defaultValue={data.selected}>
            {data.plans.map((plan) => (
              <option
                key={plan.value}
                value={plan.value}
                data-month={plan.monthlyCents === null ? undefined : String(plan.monthlyCents)}
                data-year={plan.yearlyCents === null ? undefined : String(plan.yearlyCents)}
                data-allowances={plan.allowances}
              >
                {plan.monthlyCents === null ? plan.label : `${plan.label} · ${cents(plan.monthlyCents, data.currency, "month")} or ${cents(plan.yearlyCents, data.currency, "year")}`}
              </option>
            ))}
          </select>
          <span className={"hint"} id={"plA"}>
            {data.plans.find((plan) => plan.value === data.selected)?.allowances ?? ""}
          </span>
        </div>
        <div className={"fld"}>
          <label htmlFor={"plX"}>{"Extra seats"}</label>
          <input className={"inp"} id={"plX"} type={"number"} inputMode={"numeric"} min={0} max={500} step={1} defaultValue={String(data.extraSeats)} />
          <span className={"hint"}>
            {data.extraSeatMonthlyCents === null ? "No extra-seat price is set." : `${cents(data.extraSeatMonthlyCents, data.currency, "month")} each, on top of the plan’s seats.`}
          </span>
        </div>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {"Total "}
          <b id={"plT"}>{""}</b>
          {". Continuing asks you to confirm it’s you, then opens Stripe’s secure checkout (test mode during the pilot). Casevoya never sees your card."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgPlan"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-subscription-act={"checkout"} data-org={data.organizationId}>
          {"Continue to payment"}
        </button>
      </div>
    </dialog>
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
