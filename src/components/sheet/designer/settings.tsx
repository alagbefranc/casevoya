/**
 * The Designer's Settings page, Team and seats and Security tabs (`markup/settings.tsx`, variants
 * "tab-team" and "tab-security"), rendered from the firm's records. Same DOM, classes and order,
 * and the Designer's own Settings tab strip.
 *
 * Not ported (the parts render only when the data asks for them, which the live loaders never do):
 * the Designer's "Offboard someone" button and its #dlgOff dialog (moving tasks, deadlines and
 * client authority before access closes is not built), and the continuity contact's "Change" and
 * "Preview the client notice" buttons (no writer and no client notice exist). See DECISIONS.
 */
import { Icon, Sep } from "./frame";
import { Badge, type MatterBadge } from "./matters";

/** The Designer's Settings tabs, exactly as it lists them. */
export const DESIGNER_SETTINGS_TABS = [
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

export type SettingsTab = "team" | "security";

/** Where the Designer draws the tab underline for each tab (use-sheet places it again on load). */
const UNDERLINE: Record<SettingsTab, { left: string; width: string }> = {
  team: { left: "54px", width: "88px" },
  security: { left: "874px", width: "48px" },
};

/** "Grace Lin · RCIC R709876 · this firm": parts joined by the Designer's separator. */
export type Parts = string | readonly string[];

function PartsText({ value }: { value: Parts }) {
  if (typeof value === "string") return <>{value}</>;
  const last = value.length - 1;
  return (
    <>
      {value.flatMap((part, index) => {
        const text = index === 0 ? (last === 0 ? part : `${part} `) : index === last ? ` ${part}` : ` ${part} `;
        return index === 0 ? [text] : [<Sep key={`s${index}`} />, text];
      })}
    </>
  );
}

export type SettingsHeaderData = {
  firmName: string;
  /** "Plan: Trial". Null when no plan name is on record. */
  plan: string | null;
  tab: SettingsTab;
};

/** The Designer's Settings top bar and tab strip. */
export function SettingsHeader({ data }: { data: SettingsHeaderData }) {
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
        <span className={"acts"}></span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {DESIGNER_SETTINGS_TABS.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === data.tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[data.tab]}></i>
      </div>
    </>
  );
}

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

export type TeamRow = {
  name: string;
  role: Parts;
  office: string;
  /** A badge ("On"), or plain text ("Required", "Email code"). */
  twoStep: { badge: MatterBadge } | { text: string };
  seat: Parts;
};

export type ContinuityData = {
  intro: string;
  pairs: { label: string; value: Parts }[];
  /** The Designer's prototype buttons. Never set live: nothing saves a change or sends a notice. */
  designerActions?: { change: string; preview: string };
  note: string;
};

export type TeamData = {
  summary: string;
  rows: TeamRow[];
  /** A firm owner invites from People and invitations (public.create_staff_invitation). */
  invite: boolean;
  /** The Designer's Offboard button. Never set live: offboarding is not built. */
  designerOffboard?: boolean;
  continuity: ContinuityData;
};

function TwoStep({ value }: { value: TeamRow["twoStep"] }) {
  return "badge" in value ? <Badge badge={value.badge} /> : <>{value.text}</>;
}

export function SheetSettingsTeam({ data }: { data: TeamData }) {
  const { continuity } = data;
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Team and seats"}</h1>
          <p>{data.summary}</p>
        </div>
      </div>
      <div className={"tw rv"} role={"region"} aria-label={"Team"} tabIndex={0} style={i(1)}>
        <table className={"t"}>
          <caption className={"sr"}>{"Team"}</caption>
          <thead>
            <tr>
              <th scope={"col"}>{"Person"}</th>
              <th scope={"col"}>{"Role"}</th>
              <th scope={"col"}>{"Office"}</th>
              <th scope={"col"}>{"Two-step"}</th>
              <th scope={"col"}>{"Seat"}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={5}>{"No one to show yet. Staff and the invitations you send appear here."}</td>
              </tr>
            ) : (
              data.rows.map((row, index) => (
                <tr key={index}>
                  <td>{row.name}</td>
                  <td>
                    <PartsText value={row.role} />
                  </td>
                  <td>{row.office}</td>
                  <td>
                    <TwoStep value={row.twoStep} />
                  </td>
                  <td>
                    <PartsText value={row.seat} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data.invite || data.designerOffboard ? (
        <div className={"fp-row rv"} style={{ marginTop: "12px", ...i(2) }}>
          {data.invite ? (
            <a className={"btn p sm"} href={"/sheet/invitations"}>
              {"Invite staff"}
            </a>
          ) : null}
          {data.designerOffboard ? (
            <button className={"btn sm"} data-dlg={"dlgOff"} data-fpd={"1"}>
              {"Offboard someone"}
            </button>
          ) : null}
        </div>
      ) : null}
      <section className={"panel rv"} style={i(3)}>
        <h2>
          <Icon name={"people"} />
          {"Continuity contact"}
        </h2>
        <div style={{ padding: "18px 20px" }}>
          <p style={{ margin: "0 0 14px", maxWidth: "68ch" }}>{continuity.intro}</p>
          <div className={"kv"}>
            {continuity.pairs.flatMap((pair, index) => [
              <span key={`l${index}`}>{pair.label}</span>,
              <b key={`v${index}`}>
                <PartsText value={pair.value} />
              </b>,
            ])}
          </div>
          {continuity.designerActions ? (
            <div className={"fp-row"} style={{ marginTop: "14px" }}>
              <button className={"btn sm"} data-toast={continuity.designerActions.change} data-sub={""} data-fpb={"1"}>
                {"Change continuity contact"}
              </button>
              <button className={"btn sm"} data-toast={continuity.designerActions.preview} data-sub={""} data-fpb={"1"}>
                <Icon name={"eye"} cls={"ic s"} />
                {"Preview the client notice"}
              </button>
            </div>
          ) : null}
          <p className={"fp-note"} style={{ marginTop: "12px" }}>
            <Icon name={"info"} cls={"ic s"} />
            {` ${continuity.note}`}
          </p>
        </div>
      </section>
    </>
  );
}

export type SecurityRow = { title: string; detail: string; badge: MatterBadge };

export type SecurityData = { intro: string; rows: SecurityRow[] };

export function SheetSettingsSecurity({ data }: { data: SecurityData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <h1 className={"display"}>{"Security"}</h1>
        <p>{data.intro}</p>
      </div>
      {data.rows.map((row, index) => (
        <div key={row.title} className={"li rv"} style={i(index + 1)}>
          <div>
            <b>{row.title}</b>
            <small>{row.detail}</small>
          </div>
          <span className={"r"}>
            <Badge badge={row.badge} />
          </span>
        </div>
      ))}
    </>
  );
}
