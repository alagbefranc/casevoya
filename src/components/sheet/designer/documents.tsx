/**
 * The Designer's Documents page (`markup/documents.tsx`), rendered from the firm's records.
 * Same DOM, classes and order for each tab: To review, All documents and Originals we hold.
 * Live-only: To review rows carry `data-f` (the filter chips) and a reviewable document's link
 * carries `data-doc-review` (opens the review dialog, `DocumentReviewDialog`). The review
 * dialog is built only from the Designer's own dialog parts (`.dlg`, `.fld`, `.sel`, `.ta`,
 * `.alert`, `.btn`), the same ones as the Inbox's New message dialog.
 * DOC-06, live only: an All documents card a reviewer can manage has a "Details" button
 * (`data-doc-details`, the card's facts as JSON) that fills the Document details dialog
 * (`DocumentDetailsDialog`, the same dialog parts): matters using it, use in another matter,
 * translation, type, sensitivity and expiry. Wired in document-details-acts.
 */
import { SENSITIVITIES, TRANSLATION_LANGUAGES, type DocumentDetails } from "@/modules/sheet/documents-present";
import { Empty, Icon, Pair, Sep } from "./frame";
import { FilterEmpty } from "./filter-empty";

export type DocumentsTab = "review" | "all" | "custody";
export type DocTone = "ok" | "rev" | "chg" | "bad" | "unv";
export type DocChip = { tone: DocTone; label: string };

export type ReviewRow = {
  title: string;
  /** The Designer links some documents in blue; live, every reviewable one, with its review attributes. */
  link?: { href: string; attrs?: Record<string, string> };
  flags?: string[];
  person: string;
  matter: string;
  uploaded: string;
  /** "Clean", or a quarantine with its reason ("Quarantined · not a PDF"). */
  scan: DocChip | { tone: DocTone; pair: [string, string] };
  review: DocChip | string;
};

export type DocCard = {
  title: string;
  /** A Designer preview image, a file-type icon, or the locked card. */
  thumb: { doc: string } | { icon: string } | { locked: [string, string] };
  meta?: { parts: string[]; version?: string; when?: string };
  states: DocChip[];
  /** Live only: an accepted file opens (`data-doc-open`, a signed link after an access check). */
  open?: Record<string, string>;
  /** Live only (DOC-06): the Details button's facts, for a reviewer. */
  details?: DocumentDetails;
};

export type CustodyRow = {
  original: string;
  owner: string;
  received: string;
  location: string | [string, string];
  purpose: string;
  returnBy: string | [string, string];
  acknowledged: DocChip | string;
};

export type DocumentReviewDialogData = {
  organizationId: string;
  firmName: string;
  /** "Read with Vo": shown when Vo is on, available and a document capability is on (AI-01). */
  vo?: boolean;
};

export type DocumentsData = {
  tab: DocumentsTab;
  /** "6 to review", "1 quarantined". */
  pills: string[];
  firmName: string;
  /** `filterEmpty` (live only): the hidden "Nothing matches" panel for the chips and search. */
  review?: { rows: ReviewRow[]; filterEmpty?: boolean };
  /** `filter` (live only, REP-01): the open-requests list a Reports card links to, and how to show everything. */
  all?: { cards: DocCard[]; filter?: { text: string; clear: string } | null };
  custody?: { rows: CustodyRow[] };
};

const UNDERLINE: Record<DocumentsTab, { left: string; width: string }> = {
  review: { left: "0px", width: "58px" },
  all: { left: "84px", width: "85px" },
  custody: { left: "195px", width: "104px" },
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

function Chip({ chip }: { chip: DocChip }) {
  return (
    <span className={`bd ${chip.tone}`}>
      <i></i>
      {chip.label}
    </span>
  );
}

export function DocumentsHeader({ tab, pills }: { tab: DocumentsTab; pills: string[] }) {
  const tabs: [DocumentsTab, string][] = [
    ["review", "To review"],
    ["all", "All documents"],
    ["custody", "Originals we hold"],
  ];
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"inbox"} cls={"ic s"} />
          {"Records"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"folder"} cls={"ic s"} />
          {"Documents"}
        </button>
        {pills.map((pill) => (
          <span key={pill} className={"pill"}>
            {pill}
          </span>
        ))}
        <span className={"acts"}></span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {tabs.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === tab ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={UNDERLINE[tab]}></i>
      </div>
    </>
  );
}

function Review({ rows, firmName, filterEmpty }: { rows: ReviewRow[]; firmName: string; filterEmpty?: boolean }) {
  return (
    <>
      <div className={"ph v rv"} style={i(0)}>
        <span className={"art"} style={{ "--a": "64px" } as React.CSSProperties} aria-hidden={"true"}>
          <img
            src={"/assets/generated/b2/review-queue-empty-160@1x.webp"}
            srcSet={"/assets/generated/b2/review-queue-empty-160@2x.webp 2x"}
            width={64}
            height={64}
            alt={""}
            loading={"lazy"}
            decoding={"async"}
          />
        </span>
        <div>
          <h1 className={"display"}>{"Documents"}</h1>
          <p>{`Everything waiting for a review, across all matters. “Accepted” means accepted by ${firmName} for its purpose, not validated by the government.`}</p>
        </div>
      </div>
      <div className={"bar fp-bar rv"} role={"search"} style={i(1)}>
        <Icon name={"search"} cls={"ic s"} />
        <input placeholder={"Search documents"} aria-label={"Search documents"} />
        <button className={"fchip on"} aria-pressed={"true"}>
          {"All"}
        </button>
        <button className={"fchip"} aria-pressed={"false"}>
          {"Awaiting review"}
        </button>
        <button className={"fchip"} aria-pressed={"false"}>
          {"Quarantined"}
        </button>
        <button className={"fchip"} aria-pressed={"false"}>
          {"Expiring soon"}
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={"panel rv"} style={i(2)}>
          <Empty art={"review-queue-empty"} title={"No documents waiting"} copy={"Uploads that need a review across every matter appear here."} />
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Documents to review"} tabIndex={0} style={i(2)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Documents to review"}</caption>
            <thead>
              <tr>
                {["Document", "Person", "Matter", "Uploaded", "Scan", "Review"].map((label) => (
                  <th key={label} scope={"col"}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} data-f={row.flags?.length ? row.flags.join(" ") : undefined}>
                  <td>
                    {row.link ? (
                      <a href={row.link.href} style={{ color: "var(--blue)" }} {...row.link.attrs}>
                        {row.title}
                      </a>
                    ) : (
                      row.title
                    )}
                  </td>
                  <td>{row.person}</td>
                  <td>{row.matter}</td>
                  <td>
                    <span className={"num"}>{row.uploaded}</span>
                  </td>
                  <td>
                    {"pair" in row.scan ? (
                      <span className={`bd ${row.scan.tone}`}>
                        <i></i>
                        <span>
                          <Pair left={row.scan.pair[0]} right={row.scan.pair[1]} />
                        </span>
                      </span>
                    ) : (
                      <Chip chip={row.scan} />
                    )}
                  </td>
                  <td>{typeof row.review === "string" ? row.review : <Chip chip={row.review} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filterEmpty && rows.length ? <FilterEmpty n={2} /> : null}
      <p className={"fp-note rv"} style={i(3)}>
        {"Files are checked for their real type, not the name. Quarantined files never open; the client is asked to upload again."}
      </p>
    </>
  );
}

function Thumb({ thumb, title }: { thumb: DocCard["thumb"]; title: string }) {
  if ("doc" in thumb) {
    return (
      <div className={"th doc"}>
        <button type={"button"} className={"th-b"} data-doc={thumb.doc} data-doc-t={title} aria-label={`Preview ${title}`}>
          <img src={`/assets/docs/${thumb.doc}-600.webp`} alt={""} width={52} height={69} loading={"lazy"} decoding={"async"} />
        </button>
      </div>
    );
  }
  if ("icon" in thumb) {
    return (
      <div className={"th"}>
        <Icon name={thumb.icon} cls={"ic l"} />
      </div>
    );
  }
  return (
    <div className={"th"}>
      <img src={"/assets/vo/vo-lock-96.png"} srcSet={"/assets/vo/vo-lock-192.png 2x"} width={40} height={40} alt={""} />
    </div>
  );
}

function Card({ card }: { card: DocCard }) {
  const locked = "locked" in card.thumb ? card.thumb.locked : null;
  return (
    <article
      className={locked ? "fcard locked k2-spot" : "fcard k2-spot"}
      data-spot={"1"}
      {...(card.open ? { ...card.open, role: "button", tabIndex: 0, "aria-label": `Open ${card.title}`, title: "Open the file", style: { cursor: "pointer" } } : {})}
    >
      <Thumb thumb={card.thumb} title={card.title} />
      <div>
        <h4>{card.title}</h4>
        <div className={"meta"}>
          {locked ? (
            <span>
              <Pair left={locked[0]} right={locked[1]} />
            </span>
          ) : (
            <>
              {(card.meta?.parts ?? []).map((part, index) => (
                <MetaPart key={index} first={index === 0} text={part} />
              ))}
              {card.meta?.version ? (
                <>
                  <span className={"sep"}></span>
                  <span className={"num"}>{card.meta.version}</span>
                </>
              ) : null}
              {card.meta?.when ? (
                <>
                  <span className={"sep"}></span>
                  <time className={"num"}>{card.meta.when}</time>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className={"states"}>
        {card.states.map((chip, index) => (
          <Chip key={index} chip={chip} />
        ))}
        {card.details ? (
          <button type={"button"} className={"btn s sm"} data-doc-details={JSON.stringify(card.details)} aria-label={`Details of ${card.title}`}>
            {"Details"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function MetaPart({ first, text }: { first: boolean; text: string }) {
  return (
    <>
      {first ? null : <span className={"sep"}></span>}
      <span>{text}</span>
    </>
  );
}

export const DOC_DETAILS_DIALOG = "dDocDetails";

/** DOC-06, live only: one dialog for the page, filled from the Details button that opens it. */
export function DocumentDetailsDialog() {
  return (
    <dialog className={"dlg wide"} id={DOC_DETAILS_DIALOG} aria-labelledby={"ddH"}>
      <div className={"dh"}>
        <h2 id={"ddH"}>{"Document details"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={DOC_DETAILS_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <p className={"mu"} id={"ddWho"} style={{ marginBottom: "12px" }}></p>
        <h3 className={"sub"}>{"Matters using it"}</h3>
        <ul className={"dd-refs"} id={"ddRefs"}></ul>
        <div className={"g2"}>
          <div className={"fld"}>
            <label htmlFor={"ddUse"}>{"Use in another matter"}</label>
            <small className={"hint"} id={"ddUseNote"}></small>
            <select className={"sel"} id={"ddUse"}></select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"ddWhy"}>{"Why remove it from a matter"}</label>
            <small className={"hint"}>{"Needed to remove. The file stays on the person’s record and on every other matter using it."}</small>
            <input className={"inp"} id={"ddWhy"} maxLength={500} />
          </div>
        </div>
        <button className={"btn s sm"} type={"button"} data-dd-link={"1"}>
          {"Use in this matter"}
        </button>

        <h3 className={"sub"}>{"Translation"}</h3>
        <p className={"mu"} id={"ddTr"}></p>
        <div className={"g2"}>
          <div className={"fld"}>
            <label htmlFor={"ddOrig"}>{"This is a translation of"}</label>
            <select className={"sel"} id={"ddOrig"}></select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"ddLang"}>{"Language of this translation"}</label>
            <select className={"sel"} id={"ddLang"}>
              {TRANSLATION_LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className={"btn s sm"} type={"button"} data-dd-translation={"1"}>
          {"Save translation"}
        </button>

        <h3 className={"sub"}>{"Type, sensitivity and expiry"}</h3>
        <div className={"g2"}>
          <div className={"fld"}>
            <label htmlFor={"ddPurpose"}>{"What it is"}</label>
            <input className={"inp"} id={"ddPurpose"} maxLength={200} />
          </div>
          <div className={"fld"}>
            <label htmlFor={"ddSens"}>{"Sensitivity"}</label>
            <small className={"hint"}>{"Changing it changes who may read the file."}</small>
            <select className={"sel"} id={"ddSens"}>
              {SENSITIVITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className={"fld"}>
            <label htmlFor={"ddExp"}>{"Expires on"}</label>
            <small className={"hint"}>{"The date printed on the document. Empty if it doesn’t expire."}</small>
            <input className={"inp"} id={"ddExp"} type={"date"} />
          </div>
          <div className={"fld"}>
            <label htmlFor={"ddCode"}>{"Six-digit code"}</label>
            <small className={"hint"}>{"Needed to change the sensitivity or expiry, or to remove it from a matter."}</small>
            <input className={"inp"} id={"ddCode"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} />
          </div>
        </div>
        <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
          <Icon name={"history"} cls={"ic s"} />
          {"Every change is kept in the audit log. Removing it from a matter never deletes the file."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={DOC_DETAILS_DIALOG}>
          {"Close"}
        </button>
        <button className={"btn p"} data-dd-classify={"1"}>
          {"Save details"}
        </button>
      </div>
    </dialog>
  );
}

function All({ cards, filter }: { cards: DocCard[]; filter?: { text: string; clear: string } | null }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"All documents"}</h1>
          <p>{"Every version is kept with its hash, owner and who can see it. The same document can serve several matters without copying it."}</p>
        </div>
      </div>
      {filter ? (
        <p className={"fp-note rv"} style={i(1)}>
          {`${filter.text} `}
          <a href={filter.clear} style={{ color: "var(--blue)" }}>
            {"Show all documents"}
          </a>
        </p>
      ) : null}
      {cards.length === 0 ? (
        <div className={"panel rv"} style={i(1)}>
          <Empty
            art={"review-queue-empty"}
            title={filter ? "No open requests" : "No documents yet"}
            copy={filter ? "Document requests waiting on a client or a review appear here." : "Requests and uploads from every matter you can open appear here."}
          />
        </div>
      ) : (
        <div className={"fp-cards rv"} style={i(1)}>
          {cards.map((card, index) => (
            <Card key={index} card={card} />
          ))}
        </div>
      )}
    </>
  );
}

function PairOr({ value }: { value: string | [string, string] }) {
  if (typeof value === "string") return <>{value}</>;
  return (
    <>
      {`${value[0]} `}
      <Sep />
      {` ${value[1]}`}
    </>
  );
}

function Custody({ rows }: { rows: CustodyRow[] }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Originals we hold"}</h1>
          <p>{"Paper originals in the office, with where they are and when they go back."}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className={"panel rv"} style={i(1)}>
          <Empty art={"review-queue-empty"} title={"No originals held"} copy={"Paper originals the office receives are recorded here, with where they are and when they go back."} />
        </div>
      ) : (
        <div className={"tw rv"} role={"region"} aria-label={"Custody records"} tabIndex={0} style={i(1)}>
          <table className={"t"}>
            <caption className={"sr"}>{"Custody records"}</caption>
            <thead>
              <tr>
                {["Original", "Owner", "Received", "Location", "Purpose", "Return by", "Acknowledged"].map((label) => (
                  <th key={label} scope={"col"}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td>{row.original}</td>
                  <td>{row.owner}</td>
                  <td>
                    <span className={"num"}>{row.received}</span>
                  </td>
                  <td>
                    <PairOr value={row.location} />
                  </td>
                  <td>{row.purpose}</td>
                  <td>
                    <PairOr value={row.returnBy} />
                  </td>
                  <td>{typeof row.acknowledged === "string" ? row.acknowledged : <Chip chip={row.acknowledged} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function SheetDocuments({ data }: { data: DocumentsData }) {
  if (data.tab === "all") {
    const cards = data.all?.cards ?? [];
    return (
      <>
        <All cards={cards} filter={data.all?.filter} />
        {cards.some((card) => card.details) ? <DocumentDetailsDialog /> : null}
      </>
    );
  }
  if (data.tab === "custody") return <Custody rows={data.custody?.rows ?? []} />;
  return <Review rows={data.review?.rows ?? []} firmName={data.firmName} filterEmpty={data.review?.filterEmpty} />;
}

/**
 * Live-only: review one document version. Opened by a To review row's link (`data-doc-review`);
 * use-sheet fills it from that link. Save goes through public.review_document_version (and
 * public.set_document_expiry when a date is given); the database checks role, scope and step-up.
 * "Read with Vo" (when Vo can read documents) asks Vo for proposals on this version; they wait on
 * the matter's Documents tab and change nothing until a person accepts them.
 */
export function DocumentReviewDialog({ data }: { data: DocumentReviewDialogData }) {
  return (
    <dialog className={"dlg"} id={"dlgDocRev"} aria-labelledby={"dlgDocRevH"}>
      <div className={"dh"}>
        <h2 id={"dlgDocRevH"}>{"Review document"}</h2>
        <button className={"x"} aria-label={"Close"} data-close={"dlgDocRev"}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"alert info"} id={"drAbout"}>
          <Icon name={"folder"} />
          <div>
            <b id={"drTitle"}></b>
            <span id={"drMeta"}></span>
          </div>
        </div>
        <div className={"alert warn"} id={"drPrev"} hidden>
          <Icon name={"alert"} />
          <div>
            <b>{"The last version needed changes"}</b>
            <span id={"drPrevReason"}></span>
          </div>
        </div>
        <div className={"fld"}>
          <label htmlFor={"drD"}>{"Decision"}</label>
          <select className={"sel"} id={"drD"} defaultValue={"accepted"}>
            <option value={"accepted"}>{"Accept for its purpose"}</option>
            <option value={"changes_requested"}>{"Ask for a new version"}</option>
          </select>
        </div>
        <div className={"fld"}>
          <label htmlFor={"drR"}>{"Reason"}</label>
          <small className={"hint"} id={"drR-h"}>
            {"Kept with the review. When you ask for a new version, the client sees it."}
          </small>
          <textarea className={"ta"} id={"drR"}></textarea>
        </div>
        <div className={"fld"}>
          <label htmlFor={"drE"}>{"Expires on (optional)"}</label>
          <input className={"inp"} id={"drE"} type={"date"} defaultValue={""} />
        </div>
        <div className={"alert info"}>
          <Icon name={"users"} />
          <div>
            <b>{`“Accepted” means accepted by ${data.firmName} for its purpose`}</b>
            {"It is not a government validation."}
          </div>
        </div>
      </div>
      <div className={"df"}>
        {data.vo ? (
          <button className={"btn"} data-vo-read={"1"} data-org={data.organizationId}>
            {"Read with Vo"}
          </button>
        ) : null}
        <button className={"btn"} data-doc-file={"1"} data-org={data.organizationId}>
          {"Open file"}
        </button>
        <button className={"btn"} data-close={"dlgDocRev"}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-doc-review-submit={"1"} data-org={data.organizationId}>
          {"Save review"}
        </button>
      </div>
    </dialog>
  );
}
