/**
 * The Designer's single lead page (`markup/lead.tsx`), rendered from one lead record: the top bar
 * (Book consultation, Convert to matter), the summary, the duplicate alert, Notes, Follow-ups and
 * Contact, and the Convert to a matter and Is this the same person? dialogs. Given the Designer's
 * sample values the components render the captured HTML exactly (tests/designer-fidelity.test.tsx).
 *
 * Live-only additions, all absent from the Designer render (documented in the fidelity test):
 * `data-lead-act` / `data-org` / `data-lead` / `data-version` attributes on the controls that save,
 * Close as lost and Edit in the top bar, a Done column on Follow-ups with Add follow-up, and the
 * Enquiry, Conflict check, Consultations and Stage history panels, with their dialogs (Close as
 * lost, Edit lead, Add follow-up, Conflict check, Link a booking).
 */
import type { ReactNode } from "react";
import { Icon, Pair, Sep } from "./frame";

type Attrs = Record<string, string>;
type Text = string | { left: string; right: string };

function T({ text }: { text: Text }) {
  return typeof text === "string" ? <>{text}</> : <Pair left={text.left} right={text.right} />;
}

export type LeadHeaderData = {
  name: string;
  pills: string[];
  book: { href: string; data?: Attrs | null };
  /** Absent once the lead is converted or lost. */
  convert?: Attrs | null;
  /** Live: Close as lost and Edit. */
  extra?: ReactNode;
};

export function LeadHeader({ data }: { data: LeadHeaderData }) {
  return (
    <header className={"top"}>
      <a className={"back"} href={"/sheet/pipeline"} aria-label={"Back"}>
        <Icon name={"chevron-left"} cls={"ic s"} />
      </a>
      <button className={"crumb"}>
        <Icon name={"users"} cls={"ic s"} />
        {"Leads"}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      <span className={"cs"} aria-hidden={"true"}>
        {"/"}
      </span>
      <button className={"crumb"}>
        <Icon name={"kanban"} cls={"ic s"} />
        {"Pipeline"}
      </button>
      <span className={"cs"} aria-hidden={"true"}>
        {"/"}
      </span>
      <button className={"crumb"}>
        <Icon name={"user"} cls={"ic s"} />
        {data.name}
      </button>
      {data.pills.map((pill) => (
        <span key={pill} className={"pill"}>
          {pill}
        </span>
      ))}
      <span className={"acts"}>
        {data.extra}
        <a className={"btn sm"} href={data.book.href} {...(data.book.data ?? {})}>
          {"Book consultation"}
        </a>
        {data.convert !== null ? (
          <button className={"btn p sm"} data-dlg={"dlgConv"} data-fpd={"1"} {...(data.convert ?? {})}>
            <Icon name={"folder"} cls={"ic s"} />
            {"Convert to matter"}
          </button>
        ) : null}
      </span>
    </header>
  );
}

export type LeadNote = { who: string; when: string; body: string };
export type LeadFollowUp = { task: string; owner: string; due: string; done?: Attrs | null; doneLabel?: string | null };
export type LeadDlItem = { term: string; value: Text };

export type LeadData = {
  name: string;
  summary: Text;
  duplicate?: { title: string; copy: string } | null;
  notes: LeadNote[];
  /** Live: attributes on Save note. */
  noteSave?: Attrs | null;
  followUps: LeadFollowUp[];
  /** Live: the Done column and Add follow-up. */
  followUpLive?: { add: Attrs; empty: string } | null;
  contact: LeadDlItem[];
  /** Live panels after Follow-ups (left) and after Contact (right). */
  leftAfter?: ReactNode;
  rightAfter?: ReactNode;
};

export function SheetLead({ data }: { data: LeadData }) {
  const live = data.followUpLive;
  return (
    <div className={"fp-g2 rv"} style={{ "--i": "0" } as React.CSSProperties}>
      <div>
        <div className={"ph"}>
          <div>
            <h1 className={"display"}>{data.name}</h1>
            <p>
              <T text={data.summary} />
            </p>
          </div>
        </div>
        {data.duplicate ? (
          <div className={"alert warn"}>
            <Icon name={"users"} />
            <div>
              <b>{data.duplicate.title}</b>
              {data.duplicate.copy}
            </div>
            <div className={"acts"}>
              <button className={"btn p sm"} data-dlg={"dlgDup2"} data-fpd={"1"}>
                {"Compare"}
              </button>
            </div>
          </div>
        ) : null}
        <section className={"panel"}>
          <h2>
            <Icon name={"note"} />
            {"Notes"}
          </h2>
          <div className={"fp-pad"}>
            {data.notes.map((note, index) => (
              <div key={index} className={"fp-mail"}>
                <small style={{ color: "var(--t2)" }}>
                  <Pair left={note.who} right={note.when} />
                </small>
                <p>{note.body}</p>
              </div>
            ))}
            <div className={"fld"} style={{ marginTop: "12px" }}>
              <label htmlFor={"ln"}>{"Add a note"}</label>
              <textarea className={"ta"} id={"ln"}></textarea>
            </div>
            <button className={"btn sm"} data-run={"ok"} data-done={"Note saved"} data-sub={""} data-fpr={"1"} {...(data.noteSave ?? {})}>
              <span className={"lab"}>{"Save note"}</span>
              <span className={"spin"} aria-hidden={"true"}></span>
            </button>
          </div>
        </section>
        <section className={"panel"}>
          <h2>
            <Icon name={"task"} />
            {"Follow-ups"}
          </h2>
          <div className={"tw"} role={"region"} aria-label={"Follow-ups"} tabIndex={0}>
            <table className={"t"}>
              <caption className={"sr"}>{"Follow-ups"}</caption>
              <thead>
                <tr>
                  <th scope={"col"}>{"Task"}</th>
                  <th scope={"col"}>{"Owner"}</th>
                  <th scope={"col"}>{"Due"}</th>
                  {live ? (
                    <th scope={"col"}>
                      <span className={"sr"}>{"Done"}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.followUps.map((item, index) => (
                  <tr key={index}>
                    <td>{item.task}</td>
                    <td>{item.owner}</td>
                    <td>
                      <span className={"num"}>{item.due}</span>
                    </td>
                    {live ? (
                      <td style={{ textAlign: "right" }}>
                        {item.done ? (
                          <button className={"btn sm"} type={"button"} {...item.done}>
                            {"Done"}
                          </button>
                        ) : (
                          <span className={"bd ok"}>
                            <i></i>
                            {item.doneLabel ?? "Done"}
                          </span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {live && !data.followUps.length ? (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--t2)" }}>
                      {live.empty}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {live ? (
            <div className={"fp-pad"}>
              <button className={"btn sm"} type={"button"} {...live.add}>
                <Icon name={"plus"} cls={"ic s"} />
                {"Add follow-up"}
              </button>
            </div>
          ) : null}
        </section>
        {data.leftAfter}
      </div>
      <div>
        <section className={"panel"}>
          <h2>
            <Icon name={"user"} />
            {"Contact"}
          </h2>
          <div className={"fp-pad"}>
            <dl className={"fp-dl"}>
              {data.contact.map((item) => (
                <div key={item.term}>
                  <dt>{item.term}</dt>
                  <dd>
                    <T text={item.value} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
        {data.rightAfter}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs from the capture
// ---------------------------------------------------------------------------

export type ConvertOption = { label: Text; value?: string };

export type ConvertDialogData = {
  programs: ConvertOption[];
  consultants: ConvertOption[];
  /** Live: a refusal to show before anyone presses Create matter (conflict check, sample mode). */
  warning?: { title: string; copy: string } | null;
  submit: { toast?: { title: string; sub: string } | null; data?: Attrs | null };
};

function Options({ options }: { options: ConvertOption[] }) {
  return (
    <>
      {options.map((option, index) => (
        <option key={index} value={option.value}>
          {typeof option.label === "string" ? (
            option.label
          ) : (
            <>
              {`${option.label.left} `}
              <Sep />
              {` ${option.label.right}`}
            </>
          )}
        </option>
      ))}
    </>
  );
}

export function ConvertDialog({ data }: { data: ConvertDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgConv"} aria-labelledby={"dlgConvH"}>
      <div className={"dh"}>
        <h2 id={"dlgConvH"}>{"Convert to a matter"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgConv"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p style={{ marginBottom: "12px" }}>{"Converting creates a matter from a program template. It doesn’t merge people or sign anything."}</p>
        {data.warning ? (
          <div className={"alert warn"} style={{ marginBottom: "12px" }}>
            <Icon name={"info"} />
            <div>
              <b>{data.warning.title}</b>
              {data.warning.copy}
            </div>
          </div>
        ) : null}
        <div className={"fld"}>
          <label htmlFor={"cvT"}>{"Program template"}</label>
          <select className={"sel"} id={"cvT"}>
            <Options options={data.programs} />
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"cvC"}>{"Responsible consultant"}</label>
          <select className={"sel"} id={"cvC"}>
            <Options options={data.consultants} />
          </select>
        </div>
        <div className={"alert info"}>
          <Icon name={"signature"} />
          <div>
            <b>{"Needs a signed service agreement"}</b>
            {"The matter opens in “Engagement pending” until the agreement is signed."}
          </div>
        </div>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgConv"}>
          {"Cancel"}
        </button>
        {data.submit.toast ? (
          <button className={"btn p"} data-close={"dlgConv"} data-toast={data.submit.toast.title} data-toast-sub={data.submit.toast.sub} data-toast-kind={"ok"}>
            {"Create matter"}
          </button>
        ) : (
          <button className={"btn p"} {...(data.submit.data ?? {})}>
            {"Create matter"}
          </button>
        )}
      </div>
    </dialog>
  );
}

export type DuplicateCompareData = {
  other: string;
  rows: { label: string; other: string; mine: string }[];
  different: { toast?: { title: string; sub: string } | null; data?: Attrs | null };
  same: { toast?: { title: string; sub: string } | null; data?: Attrs | null };
};

function DecisionButton({ cls, label, choice }: { cls: string; label: string; choice: DuplicateCompareData["same"] }) {
  if (choice.toast) {
    return (
      <button className={cls} data-close={"dlgDup2"} data-toast={choice.toast.title} data-toast-sub={choice.toast.sub} data-toast-kind={"ok"}>
        {label}
      </button>
    );
  }
  if (!choice.data) {
    return (
      <button className={cls} data-close={"dlgDup2"}>
        {label}
      </button>
    );
  }
  return (
    <button className={cls} {...choice.data}>
      {label}
    </button>
  );
}

export function DuplicateCompareDialog({ data }: { data: DuplicateCompareData }) {
  return (
    <dialog className={"dlg"} id={"dlgDup2"} aria-labelledby={"dlgDup2H"}>
      <div className={"dh"}>
        <h2 id={"dlgDup2H"}>{"Is this the same person?"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgDup2"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"tw"} role={"region"} aria-label={"Compare"} tabIndex={0}>
          <table className={"t"}>
            <caption className={"sr"}>{"Compare"}</caption>
            <thead>
              <tr>
                <th scope={"col"}></th>
                <th scope={"col"}>{data.other}</th>
                <th scope={"col"}>{"This lead"}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.other}</td>
                  <td>{row.mine}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className={"df"}>
        <DecisionButton cls={"btn"} label={"Different people"} choice={data.different} />
        <DecisionButton cls={"btn p"} label={"Same person"} choice={data.same} />
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Live-only panels and dialogs (Designer parts: .panel, .fp-dl, .fp-steps, .fld, .sel, .alert)
// ---------------------------------------------------------------------------

export function DlPanel({ icon, title, items, children }: { icon: string; title: string; items: LeadDlItem[]; children?: ReactNode }) {
  return (
    <section className={"panel"}>
      <h2>
        <Icon name={icon} />
        {title}
      </h2>
      <div className={"fp-pad"}>
        {items.length ? (
          <dl className={"fp-dl"}>
            {items.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>
                  <T text={item.value} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export type ConflictPanelData = {
  state: { tone: "ok" | "rev" | "bad" | "unv"; label: string };
  checked: string | null;
  note: string | null;
  open?: Attrs | null;
};

export function ConflictPanel({ data }: { data: ConflictPanelData }) {
  return (
    <section className={"panel"}>
      <h2>
        <Icon name={"shield"} />
        {"Conflict check"}
      </h2>
      <div className={"fp-pad"}>
        <p style={{ marginBottom: "10px" }}>
          <span className={`bd ${data.state.tone}`}>
            <i></i>
            {data.state.label}
          </span>
          {data.checked ? (
            <small style={{ color: "var(--t2)", marginLeft: "8px" }}>{data.checked}</small>
          ) : null}
        </p>
        {data.note ? <p style={{ marginBottom: "10px" }}>{data.note}</p> : null}
        <p className={"fp-note"} style={{ marginBottom: "10px" }}>
          {"Check other leads and client records before booking or converting. A match is a prompt to look, not a finding."}
        </p>
        {data.open ? (
          <button className={"btn sm"} type={"button"} {...data.open}>
            {"Run conflict check"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export type HistoryItem = { when: string; what: string; who: string };

export function HistoryPanel({ items }: { items: HistoryItem[] }) {
  return (
    <section className={"panel"}>
      <h2>
        <Icon name={"history"} />
        {"Stage history"}
      </h2>
      <div className={"fp-pad"}>
        <ol className={"fp-steps"}>
          {items.map((item, index) => (
            <li key={index} className={index === 0 ? "now" : ""}>
              <span className={"d"} aria-hidden={"true"}></span>
              <div>
                <b>{item.what}</b>
                <small>
                  <Pair left={item.who} right={item.when} />
                </small>
              </div>
              {index === 0 ? <span className={"sr"}>{"latest"}</span> : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export type BookingLinkRow = { when: string; title: string; state: string };

export function ConsultationsPanel({
  rows,
  link,
}: {
  rows: BookingLinkRow[];
  link?: { options: { value: string; label: string }[]; data: Attrs } | null;
}) {
  return (
    <section className={"panel"}>
      <h2>
        <Icon name={"calendar"} />
        {"Consultations"}
      </h2>
      <div className={"fp-pad"}>
        {rows.length ? (
          <dl className={"fp-dl"}>
            {rows.map((row, index) => (
              <div key={index}>
                <dt>{row.when}</dt>
                <dd>
                  <Pair left={row.title} right={row.state} />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={"fp-note"}>{"No consultation linked yet. Book one, then link it here."}</p>
        )}
        {link && link.options.length ? (
          <div className={"fld"} style={{ marginTop: "12px" }}>
            <label htmlFor={"lbB"}>{"Link a booking"}</label>
            <small className={"hint"} id={"lbB-h"}>
              {"Public bookings that are not linked to a lead yet."}
            </small>
            <select className={"sel"} id={"lbB"} aria-describedby={"lbB-h"}>
              {link.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button className={"btn sm"} type={"button"} style={{ marginTop: "8px" }} {...link.data}>
              {"Link booking"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DialogShell({ id, title, children, submit }: { id: string; title: string; children: ReactNode; submit: { label: string; data: Attrs } }) {
  return (
    <dialog className={"dlg"} id={id} aria-labelledby={`${id}H`}>
      <div className={"dh"}>
        <h2 id={`${id}H`}>{title}</h2>
        <button className={"x"} aria-label={"Close"} data-close={id}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>{children}</div>
      <div className={"df"}>
        <button className={"btn"} data-close={id}>
          {"Cancel"}
        </button>
        <button className={"btn p"} {...submit.data}>
          {submit.label}
        </button>
      </div>
    </dialog>
  );
}

export function LostDialog({ data }: { data: Attrs }) {
  return (
    <DialogShell id={"dlgLost"} title={"Close as lost"} submit={{ label: "Close as lost", data }}>
      <p style={{ marginBottom: "12px" }}>{"The lead moves to Lost. Its notes, consent and history stay. You can reopen it later."}</p>
      <div className={"fld"}>
        <label htmlFor={"lsR"}>{"Reason"}</label>
        <small className={"hint"} id={"lsR-h"}>
          {"Kept separately for reporting. For example: chose another firm, not eligible, no reply."}
        </small>
        <textarea className={"ta"} id={"lsR"} aria-describedby={"lsR-h"}></textarea>
      </div>
    </DialogShell>
  );
}

export type ConflictDialogData = {
  data: Attrs;
  matches: { label: string; detail: string }[];
};

export function ConflictDialog({ data }: { data: ConflictDialogData }) {
  return (
    <DialogShell id={"dlgConf"} title={"Conflict check"} submit={{ label: "Record result", data: data.data }}>
      <p style={{ marginBottom: "12px" }}>{"Other leads and client records that share this name, email or phone number."}</p>
      {data.matches.length ? (
        <div className={"tw"} role={"region"} aria-label={"Possible matches"} tabIndex={0} style={{ marginBottom: "12px" }}>
          <table className={"t"}>
            <caption className={"sr"}>{"Possible matches"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Record"}</th>
                <th scope={"col"}>{"Matched on"}</th>
              </tr>
            </thead>
            <tbody>
              {data.matches.map((match, index) => (
                <tr key={index}>
                  <td>{match.label}</td>
                  <td>{match.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={"alert info"} style={{ marginBottom: "12px" }}>
          <Icon name={"check-circle"} />
          <div>
            <b>{"No matching records"}</b>
            {"No other lead or client record shares this name, email or phone number."}
          </div>
        </div>
      )}
      <div className={"fld"}>
        <label htmlFor={"cfR"}>{"Result"}</label>
        <select className={"sel"} id={"cfR"} defaultValue={"clear"}>
          <option value={"clear"}>{"No conflict"}</option>
          <option value={"possible_conflict"}>{"Possible conflict: needs a consultant’s review"}</option>
          <option value={"conflict"}>{"Conflict: don’t act for this person"}</option>
        </select>
      </div>
      <div className={"fld"}>
        <label htmlFor={"cfN"}>{"Note"}</label>
        <small className={"hint"} id={"cfN-h"}>
          {"Required unless there is no conflict."}
        </small>
        <textarea className={"ta"} id={"cfN"} aria-describedby={"cfN-h"}></textarea>
      </div>
    </DialogShell>
  );
}

export type FollowUpDialogData = { data: Attrs; owners: { value: string; label: string }[]; owner: string };

export function FollowUpDialog({ data }: { data: FollowUpDialogData }) {
  return (
    <DialogShell id={"dlgFu"} title={"Add follow-up"} submit={{ label: "Add follow-up", data: data.data }}>
      <div className={"fld"}>
        <label htmlFor={"fuT"}>{"Task"}</label>
        <input className={"inp"} id={"fuT"} autoComplete={"off"} />
      </div>
      <div className={"fld"}>
        <label htmlFor={"fuO"}>{"Owner"}</label>
        <select className={"sel"} id={"fuO"} defaultValue={data.owner}>
          {data.owners.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className={"fld"}>
        <label htmlFor={"fuD"}>{"Due"}</label>
        <input className={"inp"} id={"fuD"} type={"date"} />
      </div>
    </DialogShell>
  );
}

export type EditLeadDialogData = {
  data: Attrs;
  owners: { value: string; label: string }[];
  values: {
    name: string;
    email: string;
    phone: string;
    preferred: string;
    service: string;
    country: string;
    language: string;
    dateOfBirth: string;
    sourceDetail: string;
    owner: string;
    fee: string;
    tags: string;
  };
  maxBirthDate: string;
  marketing: { granted: boolean; data: Attrs };
};

function EditField({ id, label, value, type = "text", hint, max }: { id: string; label: string; value: string; type?: string; hint?: string; max?: string }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <small className={"hint"} id={`${id}-h`}>
          {hint}
        </small>
      ) : null}
      <input className={"inp"} id={id} type={type} defaultValue={value} autoComplete={"off"} aria-describedby={hint ? `${id}-h` : undefined} min={type === "date" ? "1900-01-01" : undefined} max={max} />
    </div>
  );
}

export function EditLeadDialog({ data }: { data: EditLeadDialogData }) {
  const v = data.values;
  return (
    <dialog className={"dlg wide"} id={"dlgEdit"} aria-labelledby={"dlgEditH"}>
      <div className={"dh"}>
        <h2 id={"dlgEditH"}>{"Edit lead"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgEdit"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"g2"}>
          <EditField id={"edN"} label={"Name"} value={v.name} />
          <EditField id={"edS"} label={"Service interest"} value={v.service} />
          <EditField id={"edE"} label={"Email"} value={v.email} type={"email"} />
          <EditField id={"edP"} label={"Phone"} value={v.phone} type={"tel"} />
          <div className={"fld"}>
            <label htmlFor={"edC"}>{"Preferred contact"}</label>
            <select className={"sel"} id={"edC"} defaultValue={v.preferred}>
              <option value={""}>{"Not given"}</option>
              <option value={"email"}>{"Email"}</option>
              <option value={"phone"}>{"Phone"}</option>
            </select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"edO"}>{"Owner"}</label>
            <select className={"sel"} id={"edO"} defaultValue={v.owner}>
              <option value={""}>{"Nobody yet"}</option>
              {data.owners.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <EditField id={"edK"} label={"Country now"} value={v.country} />
          <EditField id={"edL"} label={"Language"} value={v.language} />
          <EditField id={"edD"} label={"Date of birth"} value={v.dateOfBirth} type={"date"} hint={"Optional. Helps tell people with the same name apart."} max={data.maxBirthDate} />
          <EditField id={"edF"} label={"Proposed fee (CAD)"} value={v.fee} type={"number"} hint={"The firm’s own fee."} />
          <EditField id={"edSd"} label={"Source detail"} value={v.sourceDetail} hint={"For example, who referred them."} />
          <EditField id={"edT"} label={"Tags"} value={v.tags} hint={"Separate tags with commas."} />
        </div>
        <label className={"check"}>
          <input type={"checkbox"} id={"edM"} defaultChecked={data.marketing.granted} {...data.marketing.data} />
          <span>
            {"Agreed to receive our news"}
            <small>{"Marketing consent, separate from replies. A change is recorded as a new answer."}</small>
          </span>
        </label>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={"dlgEdit"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} {...data.data}>
          {"Save"}
        </button>
      </div>
    </dialog>
  );
}
