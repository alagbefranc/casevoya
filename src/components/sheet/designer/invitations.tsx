/**
 * The Designer's People and invitations page, Staff tab (`markup/invitations.tsx`, default
 * variant), rendered from the firm's records: its staff memberships and its pending staff
 * invitations. Same DOM, classes and order. The Invite staff dialog (`#dlgS`) is the Designer's
 * own; on a real page its Send button carries `data-org` and pending rows carry
 * `data-invitation`, so use-sheet can send, resend and revoke through the database. The
 * captured markup has neither. The Clients and family tab is not ported here.
 */
import { Avatar, type SidebarPerson } from "./sidebar";
import { Empty, Icon, Pair } from "./frame";
import { Badge, type MatterBadge } from "./matters";

export type StaffRowAction =
  | { kind: "more" }
  | { kind: "revoke"; invitationId?: string }
  | { kind: "resend"; invitationId?: string };

export type StaffRow = {
  person: SidebarPerson;
  name: string;
  email: string;
  /** "Case manager", or the Designer's two-part "Owner · Licensed consultant". */
  role: string | { left: string; right: string };
  state: MatterBadge;
  /** "Two-step on", "Single use". */
  note: string;
  action: StaffRowAction;
};

export type StaffData = { firmName: string; rows: StaffRow[] };

export type StaffInviteDialogData = {
  /** Present on a real page: the Send button saves through the database. */
  organizationId?: string;
  /** "name@<the firm's domain>". */
  placeholder: string;
  /** Role labels in the Designer's order. */
  roles: string[];
  offices: string[];
  /** "24 Oct": when an invitation sent now expires. */
  expires: string;
};

/** The page's own stylesheet. The capture places it after the dialogs. */
export const INVITATIONS_CSS =
  ".ph.v{display:flex;gap:16px;align-items:flex-start}.iv{padding:4px 0}.ivr{display:grid;gap:14px;align-items:center;padding:12px 18px;font-size:14.5px}.iv.s .ivr{grid-template-columns:36px minmax(200px,1.3fr) 1fr 1fr .8fr 150px}.iv.c .ivr{grid-template-columns:36px minmax(220px,1.4fr) 1fr 1fr 170px}.ivr+.ivr{border-top:1px solid var(--line)}.ivr .av{width:36px;height:36px}.ivr b{font-weight:500;display:block}.ivr small{color:var(--t2);font-size:13px}.ivc{justify-self:start}.iva{display:flex;gap:6px;justify-content:flex-end}a.tl{color:var(--blue);text-decoration:underline;text-underline-offset:3px}\n.mailp{background:var(--canvas);border-radius:12px;padding:12px 14px;font-size:14.5px;display:grid;gap:4px}.mailp small{color:var(--t2);font-size:13px}\n@media (max-width:900px){.iv.s .ivr,.iv.c .ivr{grid-template-columns:36px 1fr;gap:4px 12px;padding:12px 14px}.ivr>*:not(.av){grid-column:2}.ivr .av{grid-row:1/span 2}.iva{justify-content:flex-start;margin-top:6px}.ph.v>svg{display:none}}";

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** The page's top bar and its Staff / Clients and family tabs, Staff selected. */
export function StaffHeader({ firmName }: { firmName: string }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {"Settings"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"user-plus"} cls={"ic s"} />
          {"People and invitations"}
        </button>
        <span className={"pill"}>{firmName}</span>
        <span className={"acts"}>
          <button className={"btn p sm"} id={"invB"}>
            <Icon name={"user-plus"} cls={"ic s"} />
            <span>{"Invite staff"}</span>
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        <button role={"tab"} data-t={"staff"} className={"on"}>
          {"Staff"}
        </button>
        <button role={"tab"} data-t={"clients"}>
          {"Clients and family"}
        </button>
        <i className={"ul"} style={{ left: "0px", width: "28px" }}></i>
      </div>
    </>
  );
}

function RowAction({ action }: { action: StaffRowAction }) {
  if (action.kind === "revoke") {
    return (
      <button className={"btn sm"} data-hold={"Invitation revoked"} aria-label={"Press and hold to revoke"} data-invitation={action.invitationId}>
        {"Hold to revoke"}
      </button>
    );
  }
  if (action.kind === "resend") {
    return (
      <button className={"btn sm"} data-t={"Invitation sent again"} data-invitation={action.invitationId}>
        {"Resend"}
      </button>
    );
  }
  return (
    <button className={"btn sm s"} aria-label={"More"}>
      <Icon name={"more"} cls={"ic s"} />
    </button>
  );
}

function Row({ row }: { row: StaffRow }) {
  return (
    <div className={"ivr"}>
      <Avatar person={row.person} />
      <div>
        <b>{row.name}</b>
        <small>{row.email}</small>
      </div>
      <span className={"ivc"}>{typeof row.role === "string" ? row.role : <Pair left={row.role.left} right={row.role.right} />}</span>
      <span className={"ivc"}>
        <Badge badge={row.state} />
      </span>
      <small className={"ivx"}>{row.note}</small>
      <span className={"iva"}>
        <RowAction action={row.action} />
      </span>
    </div>
  );
}

export function SheetStaffTab({ data }: { data: StaffData }) {
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <span className={"art"} style={{ "--a": "52px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/team-badges-160@1x.webp"}
            srcSet={"/assets/generated/b2/team-badges-160@2x.webp 2x"}
            width={52}
            height={52}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
        <div>
          <h1 className={"display"}>{"Staff"}</h1>
          <p>{"Invitations work once and expire after 7 days. Everyone uses two-step sign-in. Roles decide what each person can see and do."}</p>
        </div>
      </div>
      <div className={"panel iv s rv"} data-rb-list={"1"} style={i(1)}>
        {data.rows.length === 0 ? (
          <Empty art={"team-badges"} title={"No one to show yet"} copy={"Staff and the invitations you send appear here."} />
        ) : (
          data.rows.map((row, index) => <Row key={index} row={row} />)
        )}
      </div>
      <div className={"alert info rv"} style={i(2)}>
        <Icon name={"shield"} />
        <div>
          <b>{"Changing a role asks you to confirm it’s you"}</b>
          {"A case manager can’t release a submission, even if they also handle billing."}
        </div>
      </div>
    </>
  );
}

/** The Designer's Invite staff dialog. It sits after the frame, beside the scrim. */
export function StaffInviteDialog({ data }: { data: StaffInviteDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgS"} aria-labelledby={"dsH"}>
      <div className={"dh"}>
        <h2 id={"dsH"}>{"Invite staff"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgS"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"sE"}>{"Work email"}</label>
          <input className={"inp"} id={"sE"} type={"email"} placeholder={data.placeholder} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"sR"}>{"Role"}</label>
          <select className={"sel"} id={"sR"}>
            {data.roles.map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
          <span className={"hint"}>{"Licensed consultants add their licence when they join. It’s checked before they can sign or release."}</span>
        </div>
        <div className={"fld"}>
          <label htmlFor={"sO"}>{"Office"}</label>
          <select className={"sel"} id={"sO"}>
            {data.offices.map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
        </div>
        <p className={"why"}>
          <Icon name={"clock"} cls={"ic s"} />
          {"Works once and expires in 7 days."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgS"}>
          {"Cancel"}
        </button>
        <button
          className={"btn p"}
          data-close={"dlgS"}
          data-toast={"Invitation sent"}
          data-toast-sub={`Expires ${data.expires}. You can revoke it any time.`}
          data-toast-kind={"ok"}
          data-org={data.organizationId}
        >
          {"Send invitation"}
        </button>
      </div>
    </dialog>
  );
}

/** What follows the frame on the Staff tab: the dialog, then the page's stylesheet. */
export function StaffAfter({ dialog }: { dialog: StaffInviteDialogData }) {
  return (
    <>
      <StaffInviteDialog data={dialog} />
      <style dangerouslySetInnerHTML={{ __html: INVITATIONS_CSS }} />
    </>
  );
}
