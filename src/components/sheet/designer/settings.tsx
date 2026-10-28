/**
 * The Designer's Settings page, Team and seats and Security tabs (`markup/settings.tsx`, variants
 * "tab-team" and "tab-security"), rendered from the firm's records. Same DOM, classes and order,
 * and the Designer's own Settings tab strip.
 *
 * For a firm owner the Team tab shows the Designer's "Offboard someone" button (its #dlgOff dialog
 * is `OffboardDialog` in `settings-staff-admin.tsx`) and the continuity contact's "Change continuity
 * contact" button, which opens a dialog instead of the Designer's prototype toast. Live-only
 * additions, stripped by the fidelity test: the "Change role or access" button after "Offboard
 * someone", and `data-dlg` on "Change continuity contact" in place of its toast. "Preview the client
 * notice" is not shown: no approved client notice design exists. See DECISIONS.
 */
import { Icon, Sep } from "./frame";
import { Badge, type MatterBadge } from "./matters";
import { IDLE_TIMEOUT_DIALOG, UPLOAD_LIMIT_DIALOG } from "@/modules/sheet/settings-present";
import { IDLE_MINUTES_MAX, IDLE_MINUTES_MIN } from "@/modules/security/idle";

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

export function PartsText({ value }: { value: Parts }) {
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
  /**
   * "Change continuity contact": the Designer's prototype toast, or (live, firm owner) the dialog it
   * opens. "Preview the client notice" only with the Designer's toast: no client notice exists.
   */
  actions?: { change: { toast: string } | { dialog: string }; preview?: string };
  note: string;
};

export type TeamData = {
  summary: string;
  rows: TeamRow[];
  /** A firm owner invites from People and invitations (public.create_staff_invitation). */
  invite: boolean;
  /** The Designer's "Offboard someone" (#dlgOff). A firm owner, with someone to offboard. */
  offboard?: boolean;
  /** Live only: "Change role or access" (#dlgMem). A firm owner, with someone else on the team. */
  manage?: boolean;
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
      {data.invite || data.offboard || data.manage ? (
        <div className={"fp-row rv"} style={{ marginTop: "12px", ...i(2) }}>
          {data.invite ? (
            <a className={"btn p sm"} href={"/sheet/invitations"}>
              {"Invite staff"}
            </a>
          ) : null}
          {data.offboard ? (
            <button className={"btn sm"} data-dlg={"dlgOff"} data-fpd={"1"}>
              {"Offboard someone"}
            </button>
          ) : null}
          {data.manage ? (
            <button className={"btn sm"} data-dlg={"dlgMem"}>
              {"Change role or access"}
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
          {continuity.actions ? (
            <div className={"fp-row"} style={{ marginTop: "14px" }}>
              {"toast" in continuity.actions.change ? (
                <button className={"btn sm"} data-toast={continuity.actions.change.toast} data-sub={""} data-fpb={"1"}>
                  {"Change continuity contact"}
                </button>
              ) : (
                <button className={"btn sm"} data-dlg={continuity.actions.change.dialog} data-fpb={"1"}>
                  {"Change continuity contact"}
                </button>
              )}
              {continuity.actions.preview ? (
                <button className={"btn sm"} data-toast={continuity.actions.preview} data-sub={""} data-fpb={"1"}>
                  <Icon name={"eye"} cls={"ic s"} />
                  {"Preview the client notice"}
                </button>
              ) : null}
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

/** `action` (live only): a button after the badge, e.g. "Sign out my other sessions". */
export type SecurityRow = { title: string; detail: string; badge: MatterBadge; action?: { label: string; attrs: Record<string, string> } };

/**
 * `uploadLimit`, live only (DOC-02): the owner's Change limit dialog, in MB. `idleTimeout`, live
 * only (SEC-01): the owner's idle sign-out dialog, in minutes.
 */
export type SecurityData = {
  intro: string;
  rows: SecurityRow[];
  uploadLimit?: { organizationId: string; mb: number; max: number } | null;
  idleTimeout?: { organizationId: string; minutes: number } | null;
};

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
            {row.action ? (
              <button className={"btn s sm"} style={{ background: "#fff" }} {...row.action.attrs}>
                {row.action.label}
              </button>
            ) : null}
          </span>
        </div>
      ))}
      {data.uploadLimit ? <UploadLimitDialog data={data.uploadLimit} /> : null}
      {data.idleTimeout ? <IdleTimeoutDialog data={data.idleTimeout} /> : null}
    </>
  );
}

/**
 * Live only (SEC-01): the owner changes the idle sign-out time. The Designer has no such dialog,
 * so it is built like the upload limit's: the Designer's `.dlg` with `.fld` / `.inp` fields and the
 * six-digit code field of "Confirm it's you". public.set_staff_idle_timeout checks the owner, the
 * step-up and the bounds.
 */
function IdleTimeoutDialog({ data }: { data: NonNullable<SecurityData["idleTimeout"]> }) {
  return (
    <dialog className={"dlg"} id={IDLE_TIMEOUT_DIALOG} aria-labelledby={"dIdleSetH"}>
      <div className={"dh"}>
        <h2 id={"dIdleSetH"}>{"Idle sign-out"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={IDLE_TIMEOUT_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"idMin"}>{"Minutes without activity"}</label>
          <small className={"hint"} id={"idMin-h"}>
            {`From ${IDLE_MINUTES_MIN} to ${IDLE_MINUTES_MAX} minutes. Staff see a warning 2 minutes before they are signed out.`}
          </small>
          <input className={"inp"} id={"idMin"} type={"number"} min={IDLE_MINUTES_MIN} max={IDLE_MINUTES_MAX} step={1} defaultValue={String(data.minutes)} aria-describedby={"idMin-h"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"idC"}>{"Six-digit code"}</label>
          <input className={"inp"} id={"idC"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} />
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={IDLE_TIMEOUT_DIALOG}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-idle-timeout={"1"} data-org={data.organizationId}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}

/**
 * Live only (DOC-02): the owner changes the per-file upload limit. The Designer has no such dialog,
 * so it is the Designer's `.dlg` with `.fld` / `.inp` fields and the six-digit code field of
 * "Confirm it's you". public.set_document_upload_limit checks the owner, the step-up and the ceiling.
 */
function UploadLimitDialog({ data }: { data: NonNullable<SecurityData["uploadLimit"]> }) {
  return (
    <dialog className={"dlg"} id={UPLOAD_LIMIT_DIALOG} aria-labelledby={"dUpLimitH"}>
      <div className={"dh"}>
        <h2 id={"dUpLimitH"}>{"Upload limit per file"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={UPLOAD_LIMIT_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"ulMb"}>{"Limit in MB"}</label>
          <small className={"hint"} id={"ulMb-h"}>
            {data.max === 100 ? "From 1 to 100 MB. The default is 25 MB." : "From 1 to 25 MB. Above 25 MB stays off until Casevoya has validated storage for larger files."}
          </small>
          <input className={"inp"} id={"ulMb"} type={"number"} min={1} max={data.max} step={1} defaultValue={String(data.mb)} aria-describedby={"ulMb-h"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"ulC"}>{"Six-digit code"}</label>
          <input className={"inp"} id={"ulC"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} />
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={UPLOAD_LIMIT_DIALOG}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-upload-limit={"1"} data-org={data.organizationId} data-max={String(data.max)}>
          {"Save limit"}
        </button>
      </div>
    </dialog>
  );
}
