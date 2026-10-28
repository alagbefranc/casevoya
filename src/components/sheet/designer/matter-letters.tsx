/**
 * AI-01: letters on a matter, in the matter's right column (under Vo's Assist card) and in dialogs.
 * The Designer has no capture for them, so they are built from the design system's parts: the
 * right column's `h4` and `.card`, `.btn s sm` buttons, and the dialog anatomy the matter page's
 * other live dialogs use (`.dlg wide`, `.dh` with the close button, `.db` with `.fl` fields and an
 * `.alert` note, `.df` with Cancel and a primary button), badges as `.bd`.
 *
 * A letter is a DRAFT until a licensed member approves one exact version; only then can it be
 * downloaded (released). "Draft letter with Vo" shows only while the firm's Vo and its letter
 * switch are on; "New letter" (written by hand) always works. Controls carry `data-letter-*` and
 * `data-vo-letter` for src/components/sheet/vo-letter-acts.ts.
 */
import { Badge, type MatterBadge } from "./matters";
import { Icon, Sep } from "./frame";

export type LetterAttrs = Record<string, string | boolean>;

export type LetterCard = { id: string; title: string; badge: MatterBadge; parts: string[]; open: LetterAttrs };

export type MatterLettersData = {
  cards: LetterCard[];
  /** "Draft letter with Vo": absent while Vo or its letter switch is off. */
  vo: LetterAttrs | null;
  /** "New letter", written by hand: absent for roles that can't write letters. */
  manual: LetterAttrs | null;
  /** Shown when there are no letters yet. */
  empty: string;
};

export type LetterFactRow = { ref: string; text: string; detail: string };

export type LetterSourceRow = { ref: string; text: string; href: string | null; linkText: string; detail: string };

export type LetterDialog = {
  id: string;
  title: string;
  badge: MatterBadge;
  meta: string[];
  /** The version's text with its [F#] and [S#] markers. Editable while the letter is a draft. */
  body: string;
  editable: boolean;
  facts: LetterFactRow[];
  sources: LetterSourceRow[];
  leftOut: string[];
  /** Why it can't be released yet, or who approved it. */
  review: string;
  revise: LetterAttrs | null;
  approve: LetterAttrs | null;
  discard: LetterAttrs | null;
  download: string | null;
};

export type LetterDialogsData = {
  types: { value: string; label: string }[];
  /** The Draft letter with Vo dialog's submit, when Vo may draft letters here. */
  vo: LetterAttrs | null;
  /** The New letter dialog's submit, when the person may write letters. */
  manual: LetterAttrs | null;
  letters: LetterDialog[];
};

export const VO_LETTER_DIALOG = "dlgVoLetter";
export const NEW_LETTER_DIALOG = "dlgLetterNew";

const muted = { color: "var(--t2)", fontSize: "13px" } as const;
const listStyle = { margin: "4px 0 10px", paddingLeft: "18px", fontSize: "13.5px" } as const;

function Parts({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? (
            <>
              {" "}
              <Sep />{" "}
            </>
          ) : null}
          {part}
        </span>
      ))}
    </>
  );
}

/** The right column's Letters section. */
export function MatterLetters({ data }: { data: MatterLettersData }) {
  return (
    <>
      <h4>{"Letters"}</h4>
      {data.cards.length ? (
        data.cards.map((card) => (
          <div key={card.id} className={"card"} style={{ display: "flex", gap: "10px" }}>
            <Icon name={"mail"} cls={"ic s"} />
            <div style={{ flex: "1" }}>
              {card.title}
              <small>
                <Parts parts={card.parts} />
              </small>
              <span style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "6px" }}>
                <Badge badge={card.badge} />
                <button className={"btn s sm"} {...card.open}>
                  {"Open"}
                </button>
              </span>
            </div>
          </div>
        ))
      ) : (
        <p style={muted}>{data.empty}</p>
      )}
      {data.vo || data.manual ? (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "8px 0 4px" }}>
          {data.vo ? (
            <button className={"btn s sm"} {...data.vo}>
              <Icon name={"sparkles"} cls={"ic s"} />
              {"Draft letter with Vo"}
            </button>
          ) : null}
          {data.manual ? (
            <button className={"btn s sm"} {...data.manual}>
              <Icon name={"plus"} cls={"ic s"} />
              {"New letter"}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Head({ id, title }: { id: string; title: string }) {
  return (
    <div className={"dh"}>
      <h2 id={`${id}T`}>{title}</h2>
      <button className={"x"} aria-label={"Close"} data-x={""}>
        <Icon name={"close"} />
      </button>
    </div>
  );
}

function TypeField({ id, types }: { id: string; types: LetterDialogsData["types"] }) {
  return (
    <label className={"fl"}>
      {"Letter"}
      <select id={id} className={"sel"} defaultValue={types[0]?.value}>
        {types.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OneLetter({ letter }: { letter: LetterDialog }) {
  return (
    <dialog className={"dlg wide"} id={letter.id} aria-labelledby={`${letter.id}T`}>
      <Head id={letter.id} title={letter.title} />
      <div className={"db"}>
        <p style={{ ...muted, display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", margin: "0 0 10px" }}>
          <Badge badge={letter.badge} />
          <span>
            <Parts parts={letter.meta} />
          </span>
        </p>
        {letter.editable ? (
          <>
            <label className={"fl"}>
              {"Title"}
              <input data-letter-title={""} defaultValue={letter.title} maxLength={200} autoComplete={"off"} />
            </label>
            <label className={"fl"}>
              {"Letter (DRAFT)"}
              <textarea data-letter-body={""} defaultValue={letter.body} rows={14} maxLength={12000}></textarea>
            </label>
          </>
        ) : (
          <div style={{ background: "var(--canvas)", borderRadius: "10px", padding: "12px 14px", fontSize: "14.5px", whiteSpace: "pre-wrap" }}>{letter.body}</div>
        )}
        <h4 style={{ margin: "12px 0 2px", fontSize: "14px" }}>{"Approved facts cited"}</h4>
        {letter.facts.length ? (
          <ol style={listStyle}>
            {letter.facts.map((fact) => (
              <li key={fact.ref}>
                <b style={{ fontWeight: 500 }}>{`[${fact.ref}] `}</b>
                {fact.text}
                <small style={{ ...muted, display: "block" }}>{fact.detail}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p style={muted}>{"None. Facts typed by hand are checked at the licensed review."}</p>
        )}
        <h4 style={{ margin: "8px 0 2px", fontSize: "14px" }}>{"Official sources cited"}</h4>
        {letter.sources.length ? (
          <ol style={listStyle}>
            {letter.sources.map((source) => (
              <li key={source.ref}>
                <b style={{ fontWeight: 500 }}>{`[${source.ref}] `}</b>
                {source.text}
                <small style={{ ...muted, display: "block" }}>
                  {source.href ? (
                    <a href={source.href} target={"_blank"} rel={"noopener noreferrer"} style={{ textDecoration: "underline" }}>
                      {source.linkText}
                    </a>
                  ) : (
                    source.linkText
                  )}
                  {` · ${source.detail}`}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p style={muted}>{"None. The letter states no fee, date or program requirement from an official source."}</p>
        )}
        {letter.leftOut.length ? (
          <>
            <h4 style={{ margin: "8px 0 2px", fontSize: "14px" }}>{"Left out"}</h4>
            <ul style={listStyle}>
              {letter.leftOut.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}
        <div className={"alert info"} style={{ marginTop: "8px" }}>
          <Icon name={"lock"} />
          <div>{letter.review}</div>
        </div>
      </div>
      <div className={"df"}>
        {letter.discard ? (
          <button className={"btn"} {...letter.discard}>
            {"Discard"}
          </button>
        ) : (
          <button className={"btn"} data-x={""}>
            {"Close"}
          </button>
        )}
        {letter.revise ? (
          <button className={"btn s"} {...letter.revise}>
            {"Save as new version"}
          </button>
        ) : null}
        {letter.approve ? (
          <button className={"btn p"} {...letter.approve}>
            {"Approve"}
          </button>
        ) : null}
        {letter.download ? (
          <a className={"btn p"} href={letter.download} download={""}>
            <Icon name={"download"} cls={"ic s"} />
            {"Download final letter"}
          </a>
        ) : null}
      </div>
    </dialog>
  );
}

/** Draft letter with Vo, New letter, and one dialog per letter. */
export function MatterLetterDialogs({ data }: { data: LetterDialogsData }) {
  return (
    <>
      {data.vo ? (
        <dialog className={"dlg wide"} id={VO_LETTER_DIALOG} aria-labelledby={`${VO_LETTER_DIALOG}T`}>
          <Head id={VO_LETTER_DIALOG} title={"Draft letter with Vo"} />
          <div className={"db"}>
            <TypeField id={"vlType"} types={data.types} />
            <div className={"alert info"} style={{ marginTop: "4px" }}>
              <Icon name={"info"} />
              <div>
                {
                  "Vo writes a first draft from this matter’s approved facts only (intake answers your team reviewed), and cites each one. A fee, date or program requirement appears only with an official source a licensed member of your firm approved; anything else is left out and listed. It stays a DRAFT: nothing is sent, and it can’t be released until a licensed member approves it."
                }
              </div>
            </div>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-x={""}>
              {"Cancel"}
            </button>
            <button className={"btn p"} {...data.vo}>
              {"Draft with Vo"}
            </button>
          </div>
        </dialog>
      ) : null}
      {data.manual ? (
        <dialog className={"dlg wide"} id={NEW_LETTER_DIALOG} aria-labelledby={`${NEW_LETTER_DIALOG}T`}>
          <Head id={NEW_LETTER_DIALOG} title={"New letter"} />
          <div className={"db"}>
            <TypeField id={"nlType"} types={data.types} />
            <label className={"fl"}>
              {"Title"}
              <input id={"nlTitle"} maxLength={200} autoComplete={"off"} />
            </label>
            <label className={"fl"}>
              {"Letter"}
              <textarea id={"nlBody"} rows={12} maxLength={12000}></textarea>
            </label>
            <div className={"alert info"} style={{ marginTop: "4px" }}>
              <Icon name={"lock"} />
              <div>{"Saved as a DRAFT. A licensed member of the firm approves it before it can be released."}</div>
            </div>
          </div>
          <div className={"df"}>
            <button className={"btn"} data-x={""}>
              {"Cancel"}
            </button>
            <button className={"btn p"} {...data.manual}>
              {"Save draft"}
            </button>
          </div>
        </dialog>
      ) : null}
      {data.letters.map((letter) => (
        <OneLetter key={letter.id} letter={letter} />
      ))}
    </>
  );
}
