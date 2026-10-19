/**
 * Settings > Team and seats, staff admin dialogs (ORG-02, ORG-06, SEC-01).
 *
 * `OffboardDialog` is the Designer's own #dlgOff (`markup/settings.tsx`, every Settings variant):
 * same DOM, classes and order. Live-only additions, stripped by the fidelity test:
 * - the options carry `value` (the membership id);
 * - the dialog carries `data-facts` (the first person's preview, JSON) so the list can be rebuilt
 *   in the browser when the receiver changes;
 * - the hold button carries `data-offboard` and `data-org` in place of the Designer's prototype
 *   toast and close; use-sheet runs it after a press and hold, and the database decides.
 *
 * `MemberDialog` (#dlgMem, Change role or access) and `ContinuityDialog` (#dlgCont) are live
 * additions built from the Designer's dialog parts (`.dlg`, `.fld`, `.sel`, `.inp`, `.ta`, `.why`),
 * as the other Settings dialogs are. The Designer has no control for either.
 */
import { Icon } from "./frame";
import type { Parts } from "./settings";
import { PartsText } from "./settings";

export type OffboardItem = {
  /** The Designer's ticked box: moves or closes on its own. Unticked: needs a decision. */
  done: boolean;
  aria: string;
  title: string;
  detail: Parts;
};

export type OffboardDialogData = {
  title: string;
  intro: string;
  people: { label: Parts; value?: string }[];
  receivers: { label: string; value?: string }[];
  items: OffboardItem[];
  note: string;
  /** The Designer's prototype toast, or the live button's firm. */
  hold: { toast: string; toastSub: string } | { organizationId: string };
  /** The first person's preview, for the browser. Live only. */
  facts?: string;
};

export function OffboardDialog({ data }: { data: OffboardDialogData }) {
  const hold =
    "organizationId" in data.hold
      ? { "data-offboard": "1", "data-org": data.hold.organizationId }
      : { "data-close": "dlgOff", "data-toast": data.hold.toast, "data-toast-sub": data.hold.toastSub };
  return (
    <dialog className={"dlg wide"} id={"dlgOff"} aria-labelledby={"dlgOffH"} data-facts={data.facts}>
      <div className={"dh"}>
        <h2 id={"dlgOffH"}>{data.title}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgOff"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ margin: "0 0 14px", color: "var(--t2)" }}>{data.intro}</p>
        <div className={"fld"}>
          <label htmlFor={"ofP"}>{"Person"}</label>
          <select className={"sel"} id={"ofP"}>
            {data.people.map((person, index) => (
              <option key={person.value ?? index} value={person.value}>
                <PartsText value={person.label} />
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"ofR"}>{"Give their work to"}</label>
          <select className={"sel"} id={"ofR"}>
            {data.receivers.map((receiver, index) => (
              <option key={receiver.value ?? index} value={receiver.value}>
                {receiver.label}
              </option>
            ))}
          </select>
        </div>
        <ol className={"ofl"}>
          {data.items.map((item, index) => (
            <li key={index}>
              <span className={item.done ? "ck on" : "ck"} role={"img"} aria-label={item.aria}></span>
              <div>
                <b>{item.title}</b>
                <small>
                  <PartsText value={item.detail} />
                </small>
              </div>
            </li>
          ))}
        </ol>
        <p className={"fp-note"}>
          <Icon name={"info"} cls={"ic s"} />
          {` ${data.note}`}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgOff"}>
          {"Cancel"}
        </button>
        <button className={"btn p k2-hold"} data-confirm-hold={""} data-fph={"1"} data-hold={"1"} {...hold}>
          <i className={"k2-hf"} aria-hidden={"true"}></i>
          {"Hold to start offboarding"}
        </button>
      </div>
    </dialog>
  );
}

export type MemberDialogData = {
  organizationId: string;
  people: { label: string; value: string; role: string; suspended: boolean }[];
  roles: { label: string; value: string }[];
};

const STEP_UP_NOTE = "Saving asks you to confirm it’s you. The change is logged.";

/** Change role or access (#dlgMem): a live addition from the Designer's dialog parts. */
export function MemberDialog({ data }: { data: MemberDialogData }) {
  const first = data.people[0];
  return (
    <dialog className={"dlg"} id={"dlgMem"} aria-labelledby={"dlgMemH"}>
      <div className={"dh"}>
        <h2 id={"dlgMemH"}>{"Change role or access"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgMem"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"mmP"}>{"Person"}</label>
          <select className={"sel"} id={"mmP"} defaultValue={first?.value}>
            {data.people.map((person) => (
              <option key={person.value} value={person.value} data-role={person.role} data-suspended={person.suspended ? "1" : undefined}>
                {person.label}
              </option>
            ))}
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"mmR"}>{"Role"}</label>
          <select className={"sel"} id={"mmR"} defaultValue={first?.role}>
            {data.roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
          <span className={"hint"}>{"A licensed consultant still needs their licence added and checked on the Licences page."}</span>
        </div>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {`${STEP_UP_NOTE} Suspending someone signs them out everywhere.`}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} style={{ marginRight: "auto" }} data-member-act={"status"} data-org={data.organizationId}>
          {first?.suspended ? "Reactivate" : "Suspend"}
        </button>
        <button className={"btn"} data-close={"dlgMem"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-member-act={"role"} data-org={data.organizationId}>
          {"Save role"}
        </button>
      </div>
    </dialog>
  );
}

export type ContinuityDialogData = { organizationId: string; name: string; email: string; succession: string };

/** Change continuity contact (#dlgCont): a live addition from the Designer's dialog parts. */
export function ContinuityDialog({ data }: { data: ContinuityDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgCont"} aria-labelledby={"dlgContH"}>
      <div className={"dh"}>
        <h2 id={"dlgContH"}>{"Continuity contact"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgCont"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"fld"}>
          <label htmlFor={"ctN"}>{"Continuity contact"}</label>
          <input className={"inp"} id={"ctN"} name={"name"} defaultValue={data.name} maxLength={200} autoComplete={"off"} />
          <span className={"hint"}>{"Who looks after client files if you can’t practise. Leave empty for none."}</span>
        </div>
        <div className={"fld"}>
          <label htmlFor={"ctE"}>{"Their email"}</label>
          <input className={"inp"} id={"ctE"} name={"email"} type={"email"} defaultValue={data.email} maxLength={320} autoComplete={"off"} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"ctS"}>{"Succession note"}</label>
          <textarea className={"ta"} id={"ctS"} name={"succession"} defaultValue={data.succession} maxLength={2000} rows={4}></textarea>
          <span className={"hint"}>{"Where the plan is kept and who confirms it. Leave empty for none."}</span>
        </div>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {`${STEP_UP_NOTE} Clients aren’t notified.`}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgCont"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-continuity-save={"1"} data-org={data.organizationId}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}

/** The dialogs after the Team tab's frame: the Designer's #dlgOff, then the live additions. */
export function TeamDialogs({ offboard, member, continuity }: { offboard?: OffboardDialogData | null; member?: MemberDialogData | null; continuity?: ContinuityDialogData | null }) {
  return (
    <>
      {offboard ? <OffboardDialog data={offboard} /> : null}
      {member ? <MemberDialog data={member} /> : null}
      {continuity ? <ContinuityDialog data={continuity} /> : null}
    </>
  );
}
