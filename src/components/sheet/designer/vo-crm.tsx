/**
 * Live additions (no Designer screen exists for them): the Lead page's "Follow-up with Vo" panel
 * and the consultation record's "Call notes" panel (PRD AI-01, AI-06). Each is built from the
 * parts those pages already use: a `.panel` with an `h2` and icon, `.fp-pad`, `.fp-note` lines,
 * the `.alert warn` block, a `.fld` with a `.ta` textarea, `.fp-row` of `.btn sm` buttons, and the
 * Designer's "Drafted by Vo · needs your review" line. Behaviour is in vo-crm-acts.ts
 * (`data-vo-crm` controls); nothing here is sent or saved without a person's click.
 */
import { Icon, Pair } from "./frame";

export type VoCrmWire = Record<`data-${string}`, string>;

export type VoCrmDraftView = {
  id: string;
  body: string;
  sources: string;
  leftOut: string | null;
  needsRule: string | null;
  marketing: string | null;
  wire: VoCrmWire;
  mailbox: { toolkit: "gmail" | "outlook"; label: string }[];
  save: { label: string; hint: string } | null;
};

export type LeadVoData = {
  intro: string;
  consent: string;
  blocked: { title: string; text: string } | null;
  action: VoCrmWire | null;
  draft: VoCrmDraftView | null;
};

export type CallNotesData = {
  intro: string;
  blocked: { title: string; text: string } | null;
  form: VoCrmWire | null;
  max: number;
  draft: VoCrmDraftView | null;
};

function Blocked({ data }: { data: { title: string; text: string } }) {
  return (
    <div className={"alert warn"} style={{ marginTop: "10px" }}>
      <Icon name={"info"} />
      <div>
        <b>{data.title}</b>
        {data.text}
      </div>
    </div>
  );
}

function Draft({ draft, field, label, saveAct }: { draft: VoCrmDraftView; field: string; label: string; saveAct: string }) {
  return (
    <div data-vo-crm-draft={draft.id}>
      <small style={{ color: "var(--t2)" }}>
        <Pair left={"Drafted by Vo"} right={"needs your review"} />
      </small>
      <div className={"fld"} style={{ marginTop: "8px" }}>
        <label htmlFor={field}>{label}</label>
        <textarea className={"ta"} id={field} rows={8} maxLength={3900} defaultValue={draft.body} aria-describedby={`${field}-h`}></textarea>
        <span className={"hint"} id={`${field}-h`}>
          {draft.save?.hint ?? "Edit it before you use it."}
        </span>
      </div>
      <p className={"fp-note"} style={{ margin: "8px 0 0" }}>
        {draft.sources}
      </p>
      {draft.marketing ? (
        <p className={"fp-note"} style={{ margin: "4px 0 0" }}>
          {draft.marketing}
        </p>
      ) : null}
      {draft.leftOut ? (
        <p className={"fp-note"} style={{ margin: "4px 0 0" }}>
          {draft.leftOut}
        </p>
      ) : null}
      {draft.needsRule ? <Blocked data={{ title: "Needs a sourced fact", text: draft.needsRule }} /> : null}
      <div className={"fp-row"} style={{ marginTop: "10px" }}>
        {draft.save ? (
          <button className={"btn p sm"} type={"button"} data-vo-crm={saveAct} data-field={`#${field}`} {...draft.wire}>
            {draft.save.label}
          </button>
        ) : null}
        <button className={"btn sm"} type={"button"} data-vo-crm={"copy"} data-field={`#${field}`}>
          {"Copy text"}
        </button>
        {draft.mailbox.map((box) => (
          <button key={box.toolkit} className={"btn sm"} type={"button"} data-vo-crm={"mailbox"} data-toolkit={box.toolkit} data-field={`#${field}`} {...draft.wire}>
            {box.label}
          </button>
        ))}
        <button className={"btn sm"} type={"button"} data-vo-crm={"discard"} {...draft.wire}>
          {"Reject"}
        </button>
      </div>
    </div>
  );
}

export function LeadVoPanel({ data }: { data: LeadVoData }) {
  return (
    <section className={"panel"} id={"voLead"}>
      <h2>
        <Icon name={"sparkles"} />
        {"Follow-up with Vo"}
      </h2>
      <div className={"fp-pad"}>
        <p className={"fp-note"} style={{ margin: "0" }}>
          {data.intro}
        </p>
        <p className={"fp-note"} style={{ margin: "6px 0 0" }}>
          {data.consent}
        </p>
        {data.blocked ? <Blocked data={data.blocked} /> : null}
        {data.draft ? (
          <div style={{ marginTop: "12px" }}>
            <Draft draft={data.draft} field={"voLeadT"} label={"Follow-up"} saveAct={"lead-sent"} />
          </div>
        ) : data.action ? (
          <div className={"fp-row"} style={{ marginTop: "10px" }}>
            <button className={"btn p sm"} type={"button"} {...data.action}>
              <Icon name={"sparkles"} cls={"ic s"} />
              {"Draft follow-up with Vo"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function CallNotesPanel({ data }: { data: CallNotesData }) {
  return (
    <section className={"panel"} id={"voCall"}>
      <h2>
        <Icon name={"sparkles"} />
        {"Call notes with Vo"}
      </h2>
      <div className={"fp-pad"}>
        <p className={"fp-note"} style={{ margin: "0" }}>
          {data.intro}
        </p>
        {data.blocked ? <Blocked data={data.blocked} /> : null}
        {data.draft ? (
          <div style={{ marginTop: "12px" }}>
            <Draft draft={data.draft} field={"voCallS"} label={"Summary"} saveAct={"call-save"} />
          </div>
        ) : data.form ? (
          <div style={{ marginTop: "10px" }}>
            <div className={"fld"}>
              <label htmlFor={"voCallN"}>{"Your notes from the call"}</label>
              <textarea className={"ta"} id={"voCallN"} rows={8} maxLength={data.max} aria-describedby={"voCallN-h"}></textarea>
              <span className={"hint"} id={"voCallN-h"}>
                {"Paste them, or upload a plain-text file (.txt or .md)."}
              </span>
            </div>
            <div className={"fld"}>
              <label htmlFor={"voCallF"}>{"Upload notes"}</label>
              <input type={"file"} id={"voCallF"} accept={".txt,.md,text/plain,text/markdown"} data-vo-crm-file={"#voCallN"} />
            </div>
            <div className={"fp-row"} style={{ marginTop: "10px" }}>
              <button className={"btn p sm"} type={"button"} data-field={"#voCallN"} {...data.form}>
                <Icon name={"sparkles"} cls={"ic s"} />
                {"Summarise with Vo"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
