/**
 * Settings > Firm, Offices, Branding, and Language and time: the Designer's Settings tabs
 * (captured in `markup/settings.tsx`, variants "tab-general", "tab-offices", "tab-branding",
 * "tab-language"), with the firm's own values. Same DOM, classes and order as the capture.
 *
 * Live-only additions, all stripped by the fidelity test:
 * - the header links to "Client portal" (Settings > Client portal has no Designer tab);
 * - the top bar's `.acts` holds the page's one edit control when the signed-in person may use it
 *   ("Edit details", "Add an office", "Change my timezone"), built from the Designer's `.btn p sm`;
 * - office rows carry `data-office` and `data-dlg` so a firm owner can open the office dialog;
 * - "Replace logo" carries `data-dlg`;
 * - the dialogs after the frame (`SettingsFirmAfter`) use the Designer's `.dlg` / `.fld` / `.inp`
 *   parts, like the Client portal tab's publish dialogs. Save buttons carry `data-firm-save`
 *   and `data-org`; use-sheet sends them to the server, and the database decides.
 */
import { Fragment } from "react";
import { Icon, Sep } from "./frame";

/** The Designer's Settings tabs in its order. Client portal (no Designer tab) is a header link instead, so the strip fits. */
const SETTINGS_TABS = [
  ["general", "Firm"],
  ["team", "Team and seats"],
  ["branding", "Branding"],
  ["offices", "Offices"],
  ["billing", "Subscription"],
  ["retention", "Retention"],
  ["integrations", "Integrations"],
  ["notifications", "Notifications"],
  ["language", "Language and time"],
  ["ai", "AI"],
  ["security", "Security"],
] as const;

export type SettingsTab = "general" | "offices" | "branding" | "language";

/** The Designer's underline under each selected tab, as captured (use-sheet re-measures it). */
const UNDERLINE: Record<SettingsTab, { left: string; width: string }> = {
  general: { left: "0px", width: "28px" },
  branding: { left: "169px", width: "54px" },
  offices: { left: "249px", width: "42px" },
  language: { left: "696px", width: "111px" },
};

export type SettingsHeaderData = {
  tab: SettingsTab;
  firmName: string;
  /** "Plan: …", or null when the firm has no subscription row. */
  plan: string | null;
  /** The page's edit control, when the signed-in person may use it. */
  act?: { label: string; icon: string; dialog: string } | null;
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** The Designer's Settings top bar and tab row. */
export function SettingsFirmHeader({ data }: { data: SettingsHeaderData }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {"Settings"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"pill"}>{data.firmName}</span>
        {data.plan ? <span className={"pill"}>{data.plan}</span> : null}
        <span className={"acts"}>
          <a className={"btn sm"} href={"/sheet/settings?tab=portal"} data-live-link={"portal"}>
            {"Client portal"}
          </a>
          {data.act ? (
            <button className={"btn p sm"} data-dlg={data.act.dialog}>
              <Icon name={data.act.icon} cls={"ic s"} />
              {data.act.label}
            </button>
          ) : null}
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {SETTINGS_TABS.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === data.tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[data.tab]}></i>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Firm
// ---------------------------------------------------------------------------
/** A value, or two parts with the Designer's separator ("Canada · IRCC"). */
export type FirmValue = string | { parts: string[] };

export type FirmData = {
  firmName: string;
  rows: { label: string; value: FirmValue; num?: boolean }[];
};

function Value({ value }: { value: FirmValue }) {
  if (typeof value === "string") return <>{value}</>;
  return (
    <>
      {value.parts.map((part, index) => {
        const last = index === value.parts.length - 1;
        return (
          <Fragment key={index}>
            {`${index > 0 ? " " : ""}${part}${last ? "" : " "}`}
            {last ? null : <Sep />}
          </Fragment>
        );
      })}
    </>
  );
}

export function SheetSettingsFirm({ data }: { data: FirmData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Firm"}</h1>
          <p>{`${data.firmName}’s details. The organisation ID is the boundary for all its data.`}</p>
        </div>
      </div>
      <section className={"panel rv"} style={i(1)}>
        <h2>
          <Icon name={"building"} />
          {"Organisation"}
        </h2>
        <div className={"fp-pad"}>
          <dl className={"fp-dl"}>
            {data.rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.num ? <span className={"num"}>{typeof row.value === "string" ? row.value : row.value.parts.join(" ")}</span> : <Value value={row.value} />}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Offices
// ---------------------------------------------------------------------------
export type OfficeRow = {
  /** Live only: the office's id, for the edit dialog. */
  id?: string;
  label: string;
  address: string;
  timezone: string;
  staff: string;
};

export type OfficesData = { intro: string; rows: OfficeRow[]; empty: string; canEdit: boolean };

export function SheetSettingsOffices({ data }: { data: OfficesData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Offices"}</h1>
          <p>{data.intro}</p>
        </div>
      </div>
      <div className={"tw rv"} role={"region"} aria-label={"Offices"} tabIndex={0} style={i(1)}>
        <table className={"t"}>
          <caption className={"sr"}>{"Offices"}</caption>
          <thead>
            <tr>
              <th scope={"col"}>{"Office"}</th>
              <th scope={"col"}>{"Address"}</th>
              <th scope={"col"}>{"Timezone"}</th>
              <th scope={"col"}>{"Staff"}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((row, index) => (
                <tr key={row.id ?? index} {...(data.canEdit && row.id ? { "data-office": row.id, "data-dlg": officeDialogId(row.id) } : {})}>
                  <td>
                    <Icon name={"location"} cls={"ic s"} />
                    {` ${row.label}`}
                  </td>
                  <td>{row.address}</td>
                  <td>{row.timezone}</td>
                  <td>{row.staff}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>{data.empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------
export type BrandImage =
  | { src: string; alt: string; width?: number; height?: number }
  | { picture: { srcSet: string; type: string }; src: string; alt: string; width?: number; height?: number };

export type BrandFigure = {
  box: "brd-l" | "brd-d" | "brd-s";
  images: BrandImage[];
  /** Shown in the box when there is no image to show. */
  empty?: string;
  caption: [string, string];
};

export type BrandingData = {
  firmName: string;
  figures: BrandFigure[];
  colourTag: string;
  /** The Designer's "Replace logo" (or "Upload a logo" when none is saved); null when not allowed. */
  replace: { label: string; dialog?: string } | null;
  note: string;
  preview: { kind: "image"; src: string; alt: string } | { kind: "html"; html: string; label: string };
};

function BrandImg({ image }: { image: BrandImage }) {
  const img = <img src={image.src} alt={image.alt} width={image.width} height={image.height} />;
  if ("picture" in image) {
    return (
      <picture>
        <source srcSet={image.picture.srcSet} type={image.picture.type} />
        {img}
      </picture>
    );
  }
  return img;
}

export function SheetSettingsBranding({ data }: { data: BrandingData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Branding"}</h1>
          <p>{`How ${data.firmName} appears in the portal, emails and the booking page.`}</p>
        </div>
      </div>
      <div className={"fp-g2 rv"} style={i(1)}>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"image"} />
              {"Logo and colour"}
            </h2>
            <div className={"fp-pad"}>
              <div className={"brd-g"}>
                {data.figures.map((figure, index) => (
                  <figure key={index}>
                    <div className={figure.box}>
                      {figure.images.length ? figure.images.map((image, n) => <BrandImg key={n} image={image} />) : <span>{figure.empty ?? ""}</span>}
                    </div>
                    <figcaption>
                      {`${figure.caption[0]} `}
                      <Sep />
                      {` ${figure.caption[1]}`}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <div className={"fp-row"} style={{ marginTop: "12px" }}>
                <span className={"fp-tag"}>{data.colourTag}</span>
                {data.replace ? (
                  <button className={"btn s sm"} {...(data.replace.dialog ? { "data-dlg": data.replace.dialog } : {})}>
                    <Icon name={"upload"} cls={"ic s"} />
                    {data.replace.label}
                  </button>
                ) : null}
              </div>
              <p className={"fp-note"}>{data.note}</p>
            </div>
          </section>
        </div>
        <div>
          <section className={"panel"}>
            <h2>
              <Icon name={"mail"} />
              {"Email preview"}
            </h2>
            <div className={"fp-pad"}>
              {data.preview.kind === "image" ? (
                <img src={data.preview.src} alt={data.preview.alt} style={{ width: "100%", borderRadius: "8px" }} />
              ) : (
                <div role={"img"} aria-label={data.preview.label} style={{ width: "100%", borderRadius: "8px", overflow: "hidden", background: "#fff" }} dangerouslySetInnerHTML={{ __html: data.preview.html }} />
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Language and time
// ---------------------------------------------------------------------------
export type LanguageData = {
  rows: { name: string; language: string; timezone: string }[];
  empty: string;
  alert: { title: string; body: string };
};

export function SheetSettingsLanguage({ data }: { data: LanguageData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Language and time"}</h1>
          <p>{"Stored per person. Reminders use each person’s timezone, and official deadlines keep their own timezone too."}</p>
        </div>
      </div>
      <div className={"tw rv"} role={"region"} aria-label={"People"} tabIndex={0} style={i(1)}>
        <table className={"t"}>
          <caption className={"sr"}>{"People"}</caption>
          <thead>
            <tr>
              <th scope={"col"}>{"Person"}</th>
              <th scope={"col"}>{"Language"}</th>
              <th scope={"col"}>{"Timezone"}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((row, index) => (
                <tr key={index}>
                  <td>{row.name}</td>
                  <td>{row.language}</td>
                  <td>{row.timezone}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3}>{data.empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={"alert info rv"} style={i(2)}>
        <Icon name={"language"} />
        <div>
          <b>{data.alert.title}</b>
          {data.alert.body}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialogs (live only, from the Designer's dialog parts)
// ---------------------------------------------------------------------------
export const FIRM_DIALOG = "dlgFirm";
export const OFFICE_NEW_DIALOG = "dlgOffice";
export const BRAND_DIALOG = "dlgBrand";
export const TIMEZONE_DIALOG = "dlgTz";

export function officeDialogId(officeId: string): string {
  return `dlgOffice-${officeId}`;
}

export type FirmField = { id: string; key: string; label: string; value: string; type?: "text" | "email"; max: number; hint?: string };

export type OfficeDialogData = {
  id: string | null;
  label: string;
  addressLine: string;
  locality: string;
  region: string;
  postalCode: string;
  countryCode: string;
  timezone: string;
  primary: boolean;
};

export type SettingsDialogs = {
  organizationId: string;
  firm?: { fields: FirmField[] };
  offices?: { offices: OfficeDialogData[]; firmTimezone: string };
  brand?: { accent: string; logoLocator: string };
  timezone?: { mine: string; firm: string | null };
  /** IANA names for the timezone inputs' suggestions. */
  zones?: string[];
};

function Dialog({ id, title, wide, children, save, extra }: { id: string; title: string; wide?: boolean; children: React.ReactNode; save: Record<string, string>; extra?: React.ReactNode }) {
  return (
    <dialog className={wide ? "dlg wide" : "dlg"} id={id} aria-labelledby={`${id}H`}>
      <div className={"dh"}>
        <h2 id={`${id}H`}>{title}</h2>
        <button className={"x"} aria-label={"Close"} data-close={id}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>{children}</div>
      <div className={"df"}>
        {extra}
        <button className={"btn"} data-close={id}>
          {"Cancel"}
        </button>
        <button className={"btn p"} {...save}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}

function Field({ id, label, value, type = "text", max, hint, list, name }: { id: string; label: string; value: string; type?: string; max: number; hint?: string; list?: string; name?: string }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      <input className={"inp"} id={id} name={name} type={type} defaultValue={value} maxLength={max} list={list} autoComplete={"off"} />
      {hint ? <span className={"hint"}>{hint}</span> : null}
    </div>
  );
}

const STEP_UP_NOTE = "Saving asks you to confirm it’s you. The change is logged.";

function OfficeDialog({ office, organizationId, firmTimezone }: { office: OfficeDialogData; organizationId: string; firmTimezone: string }) {
  const id = office.id ? officeDialogId(office.id) : OFFICE_NEW_DIALOG;
  const k = office.id ? `o${office.id.slice(0, 8)}` : "oN";
  return (
    <Dialog
      id={id}
      title={office.id ? `Edit ${office.label}` : "Add an office"}
      save={{ "data-firm-save": "office", "data-org": organizationId, ...(office.id ? { "data-office": office.id } : {}) }}
      extra={
        office.id && !office.primary ? (
          <button className={"btn"} style={{ marginRight: "auto" }} data-firm-save={"office-remove"} data-org={organizationId} data-office={office.id}>
            {"Remove office"}
          </button>
        ) : null
      }
    >
      <Field id={`${k}L`} name={"label"} label={"Office name"} value={office.label} max={120} />
      <Field id={`${k}A`} name={"addressLine"} label={"Street address"} value={office.addressLine} max={300} />
      <Field id={`${k}C`} name={"locality"} label={"City"} value={office.locality} max={120} />
      <Field id={`${k}R`} name={"region"} label={"Province or state"} value={office.region} max={80} />
      <Field id={`${k}P`} name={"postalCode"} label={"Postal code"} value={office.postalCode} max={20} />
      <Field id={`${k}K`} name={"countryCode"} label={"Country code"} value={office.countryCode} max={2} hint={"Two letters, like CA."} />
      <Field id={`${k}Z`} name={"timezone"} label={"Timezone"} value={office.timezone} max={64} list={"tzList"} hint={`Leave empty to use the firm’s timezone (${firmTimezone}).`} />
      <label className={"check"}>
        <input type={"checkbox"} name={"primary"} defaultChecked={office.primary} disabled={office.primary} />
        <span>{"Main office"}</span>
      </label>
      <p className={"why"}>
        <Icon name={"shield"} cls={"ic s"} />
        {STEP_UP_NOTE}
      </p>
    </Dialog>
  );
}

export function SettingsFirmAfter({ data }: { data: SettingsDialogs }) {
  const org = data.organizationId;
  return (
    <>
      {data.zones?.length ? (
        <datalist id={"tzList"}>
          {data.zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      ) : null}
      {data.firm ? (
        <Dialog id={FIRM_DIALOG} title={"Edit firm details"} wide save={{ "data-firm-save": "firm", "data-org": org }}>
          {data.firm.fields.map((field) => (
            <Field key={field.key} id={field.id} name={field.key} label={field.label} value={field.value} type={field.type} max={field.max} hint={field.hint} />
          ))}
          <p className={"why"}>
            <Icon name={"shield"} cls={"ic s"} />
            {STEP_UP_NOTE}
          </p>
        </Dialog>
      ) : null}
      {data.offices ? (
        <>
          <OfficeDialog
            office={{ id: null, label: "", addressLine: "", locality: "", region: "", postalCode: "", countryCode: "CA", timezone: "", primary: data.offices.offices.length === 0 }}
            organizationId={org}
            firmTimezone={data.offices.firmTimezone}
          />
          {data.offices.offices.map((office) => (
            <OfficeDialog key={office.id} office={office} organizationId={org} firmTimezone={data.offices!.firmTimezone} />
          ))}
        </>
      ) : null}
      {data.brand ? (
        <Dialog id={BRAND_DIALOG} title={"Logo and colour"} save={{ "data-firm-save": "brand", "data-org": org }}>
          <div className={"fld"}>
            <label htmlFor={"brF"}>{"Logo"}</label>
            <input className={"inp"} id={"brF"} name={"logo"} type={"file"} accept={"image/png,image/jpeg"} />
            <span className={"hint"}>{data.brand.logoLocator ? "PNG or JPG, under 2 MB. Leave empty to keep your current logo." : "PNG or JPG, under 2 MB."}</span>
            <input type={"hidden"} name={"logoLocator"} defaultValue={data.brand.logoLocator} />
          </div>
          <Field id={"brC"} name={"accent"} label={"Firm colour"} value={data.brand.accent} max={7} hint={"A hex colour like #0A4B93. Leave empty for none."} />
          <p className={"why"}>
            <Icon name={"shield"} cls={"ic s"} />
            {STEP_UP_NOTE}
          </p>
        </Dialog>
      ) : null}
      {data.timezone ? (
        <Dialog id={TIMEZONE_DIALOG} title={"Language and time"} save={{ "data-firm-save": "timezone", "data-org": org }}>
          <Field id={"tzM"} name={"mine"} label={"Your timezone"} value={data.timezone.mine} max={64} list={"tzList"} hint={"Your reminders and times use it."} />
          {data.timezone.firm !== null ? (
            <Field id={"tzF"} name={"firm"} label={"Firm timezone"} value={data.timezone.firm} max={64} list={"tzList"} hint={"Used for firm-wide times and offices without their own. Changing it asks you to confirm it’s you."} />
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
