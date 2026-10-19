/**
 * The Designer's Settings page (`markup/settings.tsx`), Integrations and Notifications tabs. Same
 * DOM, classes and order as each captured tab: the Settings top bar and the Designer's tab strip,
 * `.ph`, `h3.sub` and `.li` rows with a logo, a name with its tag, a badge and buttons, or a
 * `.k2-sw` switch. The rows come from the firm's real state (src/modules/sheet/settings-integrations-present.ts).
 *
 * Live-only parts, all built from the Designer's own pieces and absent from its sample data: rows
 * before the Microsoft 365 row (Casevoya mail, Casevoya calendar, the connected-accounts switch),
 * `data-*` attributes and `disabled` on buttons, and the connected-accounts disclosure dialog.
 */
import { Icon, Pair } from "./frame";
import { Badge, type MatterBadge } from "./matters";
import type { Attrs } from "./drafts";

export type SettingsTab = "integrations" | "notifications";

/** The Designer's Settings tabs, in its order (no others: the strip is the Designer's). */
const TABS: { key: string; label: string }[] = [
  { key: "general", label: "Firm" },
  { key: "team", label: "Team and seats" },
  { key: "branding", label: "Branding" },
  { key: "offices", label: "Offices" },
  { key: "billing", label: "Subscription" },
  { key: "retention", label: "Retention" },
  { key: "integrations", label: "Integrations" },
  { key: "notifications", label: "Notifications" },
  { key: "language", label: "Language and time" },
  { key: "ai", label: "AI" },
  { key: "security", label: "Security" },
];

/** Where the capture drew the underline under each tab (the page moves it to the real tab on load). */
const UNDERLINE: Record<SettingsTab, { left: string; width: string }> = {
  integrations: { left: "499px", width: "69px" },
  notifications: { left: "594px", width: "76px" },
};

export type Text = string | { left: string; right: string };

function Show({ text }: { text: Text }) {
  return typeof text === "string" ? <>{text}</> : <Pair left={text.left} right={text.right} />;
}

const I = (n: number) => ({ "--i": String(n) }) as React.CSSProperties;

export function IntegrationsSettingsHeader({ tab, pills }: { tab: SettingsTab; pills: string[] }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {"Settings"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        {pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}></span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {TABS.map((item) => (
          <button key={item.key} role={"tab"} data-t={item.key} className={item.key === tab ? "on" : undefined}>
            {item.label}
          </button>
        ))}
        <i className={"ul"} style={{ left: UNDERLINE[tab].left, width: UNDERLINE[tab].width }}></i>
      </div>
    </>
  );
}

/** The Designer's `.k2-sw` switch. */
export type SettingsSwitch = { id: string; on: boolean; sr: string; attrs?: Attrs };

function Switch({ item }: { item: SettingsSwitch }) {
  return (
    <button type={"button"} className={"k2-sw"} role={"switch"} aria-checked={item.on ? "true" : "false"} id={item.id} {...item.attrs}>
      <span className={"k2-th"} aria-hidden={"true"}></span>
      <span className={"k2-sr"}>{item.sr}</span>
    </button>
  );
}

/** The Designer's "notify me" bell (its "Later" rows). */
export type SettingsBell = { label: string; off: string; on: string; pressed: boolean; width: string };

function Bell({ bell }: { bell: SettingsBell }) {
  return (
    <button type={"button"} className={"k2-bell fit"} aria-pressed={bell.pressed ? "true" : "false"} aria-label={bell.label} style={{ width: bell.width }}>
      <span className={"k2-bell-g"}>
        <span className={"k2-bell-gl"}>
          <svg viewBox={"0 0 24 24"} aria-hidden={"true"} fill={"none"} stroke={"currentColor"} strokeWidth={"1.7"} strokeLinejoin={"round"}>
            <path d={"M6 16.5V10a6 6 0 0 1 12 0v6.5l1.6 2.3H4.4L6 16.5z"} />
            <path d={"M10 21h4"} strokeLinecap={"round"} />
          </svg>
        </span>
        <svg className={"k2-bell-w l"} viewBox={"0 0 14 14"} aria-hidden={"true"}>
          <path d={"M10 3a6 6 0 0 0 0 8"} />
        </svg>
        <svg className={"k2-bell-w r"} viewBox={"0 0 14 14"} aria-hidden={"true"}>
          <path d={"M4 3a6 6 0 0 1 0 8"} />
        </svg>
      </span>
      <span className={"k2-bell-say"}>
        <span className={"k2-bell-f off"}>{bell.off}</span>
        <span className={"k2-bell-f on"}>{bell.on}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------------------------

export type IntegrationRow = {
  /** A 22px logo; null for a row without one (the connected-accounts switch). */
  logo: string | null;
  name: string;
  /** The tag after the name ("planned", "built in", "optional"); null for none. */
  tag: string | null;
  sub: Text;
  state?: MatterBadge | null;
  toggle?: SettingsSwitch | null;
  /** The unlink button's attributes (aria-label first), or null for none. */
  unlink?: Attrs | null;
  action?: { label: string; attrs?: Attrs } | null;
  bell?: SettingsBell | null;
};

export type IntegrationsData = {
  title: string;
  intro: string;
  /** Live-only rows placed before the Microsoft 365 row. */
  lead?: IntegrationRow[];
  /** The Microsoft 365 row's note. */
  microsoft: Text;
  rows: IntegrationRow[];
};

function Row({ row, index }: { row: IntegrationRow; index: number }) {
  return (
    <div className={"li rv"} style={I(index)}>
      {row.logo ? <img src={row.logo} alt={""} style={{ width: "22px", height: "22px" }} /> : null}
      <div>
        {row.tag ? (
          <b>
            {`${row.name} `}
            <small style={{ display: "inline" }}>
              {" "}
              <span className={"sep"} aria-hidden={"true"}></span>
              {` ${row.tag}`}
            </small>
          </b>
        ) : (
          <b>{row.name}</b>
        )}
        <small>
          <Show text={row.sub} />
        </small>
      </div>
      <span className={"r"}>
        {row.state ? <Badge badge={row.state} /> : null}
        {row.toggle ? <Switch item={row.toggle} /> : null}
        {row.unlink ? (
          <button className={"btn sm"} style={{ background: "none" }} {...row.unlink}>
            <Icon name={"unlink"} cls={"ic s"} />
          </button>
        ) : null}
        {row.action ? (
          <button className={"btn s sm"} style={{ background: "#fff" }} {...row.action.attrs}>
            {row.action.label}
          </button>
        ) : null}
        {row.bell ? <Bell bell={row.bell} /> : null}
      </span>
    </div>
  );
}

export function SheetIntegrations({ data }: { data: IntegrationsData }) {
  const lead = data.lead ?? [];
  const first = 2 + lead.length;
  return (
    <>
      <div className={"ph rv"} style={I(0)}>
        <h1 className={"display"}>{data.title}</h1>
        <p>{data.intro}</p>
      </div>
      <h3 className={"sub rv"} style={{ fontWeight: "500", ...I(1) }}>
        <Icon name={"plug"} cls={"ic s"} />
        {" Integrations"}
      </h3>
      {lead.map((row, index) => (
        <Row key={row.name} row={row} index={2 + index} />
      ))}
      <div className={"li rv"} style={{ alignItems: "center", ...I(first) }}>
        <div style={{ display: "flex", gap: "18px", alignItems: "center", flexWrap: "wrap" }}>
          <img src={"/assets/logos/microsoft365-wordmark.svg"} alt={"Microsoft 365"} height={16} style={{ height: "16px", width: "auto" }} />
          <img src={"/assets/logos/microsoftoutlook-wordmark.svg"} alt={"Outlook"} height={16} style={{ height: "16px", width: "auto" }} />
          <img src={"/assets/logos/microsoftteams-wordmark.svg"} alt={"Microsoft Teams"} height={16} style={{ height: "16px", width: "auto" }} />
        </div>
        <small className={"mu"} style={{ marginLeft: "auto" }}>
          <Show text={data.microsoft} />
        </small>
      </div>
      {data.rows.map((row, index) => (
        <Row key={row.name} row={row} index={first + 1 + index} />
      ))}
    </>
  );
}

/** The firm owner's disclosure before connected accounts turn on (live only; the Designer's offboarding `.dlg` parts). */
export type ComposioDialogData = {
  organizationId: string;
  lead: string;
  points: { title: string; detail: string }[];
  source: { label: string; href: string };
};

export const COMPOSIO_DIALOG = "dlgComposio";

/** The same disclosure for WhatsApp Connect: Zernio, then Meta's sign-up (live only). */
export function WhatsAppDialog({ data }: { data: ComposioDialogData }) {
  return (
    <ComposioDialog
      data={data}
      id={"dlgWhatsApp"}
      title={"Connect WhatsApp through Zernio and Meta"}
      accept={{ label: "Accept and continue to Meta", attrs: { "data-wa-connect": "1", "data-org": data.organizationId } }}
    />
  );
}

export function ComposioDialog({
  data,
  id = COMPOSIO_DIALOG,
  title = "Turn on connected accounts",
  accept,
}: {
  data: ComposioDialogData;
  id?: string;
  title?: string;
  accept?: { label: string; attrs: Attrs };
}) {
  return (
    <dialog className={"dlg wide"} id={id} aria-labelledby={`${id}H`}>
      <div className={"dh"}>
        <h2 id={`${id}H`}>{title}</h2>
        <button className={"x"} aria-label={"Close"} data-close={id}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ margin: "0 0 14px", color: "var(--t2)" }}>{data.lead}</p>
        <ol className={"ofl"}>
          {data.points.map((point) => (
            <li key={point.title}>
              <span className={"ck on"} role={"img"} aria-label={"Part of what you accept"}></span>
              <div>
                <b>{point.title}</b>
                <small>{point.detail}</small>
              </div>
            </li>
          ))}
        </ol>
        <p className={"fp-note"}>
          <Icon name={"info"} cls={"ic s"} />
          {" Review this against your privacy obligations before you accept: "}
          <a href={data.source.href} target={"_blank"} rel={"noreferrer"}>
            {data.source.label}
          </a>
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={id}>
          {"Cancel"}
        </button>
        {accept ? (
          <button className={"btn p"} {...accept.attrs}>
            {accept.label}
          </button>
        ) : (
          <button className={"btn p"} data-composio-enable={"1"} data-org={data.organizationId}>
            {"Accept and turn on"}
          </button>
        )}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------

export type NotificationPrefRow = {
  label: string;
  small: Text;
  /** The Designer's sleeping Vo before the quiet-hours row. */
  art?: boolean;
  control: { kind: "switch"; item: SettingsSwitch } | { kind: "badge"; badge: MatterBadge } | { kind: "bell"; bell: SettingsBell };
};

export type NotificationPrefSection = { title: string; rows: NotificationPrefRow[] };

export type NotificationPrefsData = { intro: string; sections: NotificationPrefSection[] };

function PrefRow({ row, index }: { row: NotificationPrefRow; index: number }) {
  return (
    <div className={"li rv"} style={I(index)}>
      {row.art ? <img src={"/assets/vo/vo-sleep-96.png"} srcSet={"/assets/vo/vo-sleep-192.png 2x"} width={40} height={40} alt={""} style={{ flex: "none" }} /> : null}
      <div>
        <b>{row.label}</b>
        <small>
          <Show text={row.small} />
        </small>
      </div>
      <span className={"r"}>
        {row.control.kind === "switch" ? (
          <Switch item={row.control.item} />
        ) : row.control.kind === "badge" ? (
          <Badge badge={row.control.badge} />
        ) : (
          <Bell bell={row.control.bell} />
        )}
      </span>
    </div>
  );
}

export function SheetNotificationPrefs({ data }: { data: NotificationPrefsData }) {
  // Each section's heading index: the page heading is 0, then headings and rows count up.
  const starts = data.sections.reduce<number[]>((list, section, n) => [...list, n === 0 ? 1 : list[n - 1] + data.sections[n - 1].rows.length + 1], []);
  return (
    <>
      <div className={"ph rv"} style={I(0)}>
        <h1 className={"display"}>{"Notifications"}</h1>
        <p>{data.intro}</p>
      </div>
      {data.sections.map((section, n) => (
        <SectionRows key={section.title} section={section} start={starts[n]} />
      ))}
    </>
  );
}

function SectionRows({ section, start }: { section: NotificationPrefSection; start: number }) {
  return (
    <>
      <h3 className={"sub rv"} style={{ fontWeight: "500", ...I(start) }}>
        {section.title}
      </h3>
      {section.rows.map((row, offset) => (
        <PrefRow key={row.label} row={row} index={start + 1 + offset} />
      ))}
    </>
  );
}
