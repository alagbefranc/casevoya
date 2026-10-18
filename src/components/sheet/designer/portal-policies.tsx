/**
 * Settings > Client portal: the firm's published portal terms of use and privacy notice, and the
 * dialogs that publish a new version. The Designer has no screen for this, so it is assembled
 * only from the Designer's own Settings parts: the Settings top bar and tab row, `.ph`, `section.panel`
 * with `.fp-pad` / `dl.fp-dl`, `.fp-row`, `.alert`, `.fp-note`, and a `.dlg wide` dialog with
 * `.fld` / `.inp` / `textarea.ta` fields. Publish buttons carry `data-policy` and `data-org` so
 * use-sheet saves through the database (public.publish_portal_policy decides).
 */
import { Icon } from "./frame";
import { Badge } from "./matters";
import { POLICY_BODY_MAX, POLICY_DIALOG, POLICY_KINDS, POLICY_NAME, POLICY_PAGE, type PolicyKind } from "@/modules/portal-policies/defaults";

/** The Designer's Settings tabs, in its order, then this one. */
export const SETTINGS_TABS = [
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
  ["portal", "Client portal"],
] as const;

export type PolicyCard = {
  kind: PolicyKind;
  /** Null until the firm publishes this kind. */
  current: { versionLabel: string; title: string; publishedOn: string } | null;
};

export type PortalPoliciesData = {
  firmName: string;
  cards: PolicyCard[];
  /** False for roles public.publish_portal_policy refuses: the page is read-only. */
  canPublish: boolean;
  /** The privacy contact is not set on the firm: the drafts carry blanks for it. */
  contactMissing: boolean;
};

export type PolicyDialogData = {
  kind: PolicyKind;
  organizationId: string;
  versionLabel: string;
  title: string;
  body: string;
  /** True when the text is the starting draft rather than the published version. */
  draft: boolean;
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

/** The Designer's Settings top bar and tabs, with Client portal selected. */
export function SettingsPortalHeader({ firmName }: { firmName: string }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"settings"} cls={"ic s"} />
          {"Settings"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"pill"}>{firmName}</span>
        <span className={"acts"}></span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        {SETTINGS_TABS.map(([key, label]) => (
          <button key={key} role={"tab"} data-t={key} className={key === "portal" ? "on" : undefined}>
            {label}
          </button>
        ))}
        <i className={"ul"} style={{ left: "0px", width: "28px" }}></i>
      </div>
    </>
  );
}

const ICON: Record<PolicyKind, string> = { portal_terms: "file-check", privacy_notice: "privacy" };

function Card({ card, canPublish, index }: { card: PolicyCard; canPublish: boolean; index: number }) {
  const dialog = POLICY_DIALOG[card.kind].id;
  return (
    <section className={"panel rv"} style={i(index)}>
      <h2>
        <Icon name={ICON[card.kind]} />
        {POLICY_NAME[card.kind]}
      </h2>
      <div className={"fp-pad"}>
        <dl className={"fp-dl"}>
          <div>
            <dt>{"Status"}</dt>
            <dd>
              <Badge badge={card.current ? { tone: "ok", label: "Published" } : { tone: "bad", label: "Not published" }} />
            </dd>
          </div>
          <div>
            <dt>{"Version"}</dt>
            <dd>{card.current ? <span className={"num"}>{card.current.versionLabel}</span> : "—"}</dd>
          </div>
          <div>
            <dt>{"Title"}</dt>
            <dd>{card.current?.title ?? "—"}</dd>
          </div>
          <div>
            <dt>{"Published"}</dt>
            <dd>{card.current?.publishedOn ?? "—"}</dd>
          </div>
        </dl>
        {canPublish ? (
          <div className={"fp-row"} style={{ marginTop: "12px" }}>
            <button className={card.current ? "btn sm" : "btn p sm"} data-dlg={dialog}>
              <Icon name={"edit"} cls={"ic s"} />
              {card.current ? "Publish a new version" : "Review and publish"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function SheetPortalPolicies({ data }: { data: PortalPoliciesData }) {
  const missing = data.cards.filter((card) => !card.current);
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <div>
          <h1 className={"display"}>{"Client portal"}</h1>
          <p>{`The terms of use and privacy notice clients accept when they join ${data.firmName}’s portal. Published text never changes; publishing again adds a new version, and clients accept the newest one.`}</p>
        </div>
      </div>
      {missing.length ? (
        <div className={"alert warn rv"} style={i(1)} role={"status"}>
          <Icon name={"alert"} />
          <div>
            <b>{"Clients can’t accept portal invitations yet"}</b>
            {missing.length === 2
              ? "Publish both the terms of use and the privacy notice. Until then, anyone you invite stops at the accept screen."
              : `Publish the ${POLICY_NAME[missing[0].kind].toLowerCase()}. Until then, anyone you invite stops at the accept screen.`}
          </div>
        </div>
      ) : null}
      {!data.canPublish ? (
        <div className={"alert info rv"} style={i(1)}>
          <Icon name={"lock"} />
          <div>
            <b>{"Only a firm owner or licensed consultant can publish"}</b>
            {"Ask them to review and publish these documents."}
          </div>
        </div>
      ) : null}
      <div className={"fp-g2 rv"} style={i(2)}>
        {data.cards.map((card, index) => (
          <div key={card.kind}>
            <Card card={card} canPublish={data.canPublish} index={index + 2} />
          </div>
        ))}
      </div>
      <p className={"fp-note rv"} style={i(3)}>
        <Icon name={"info"} cls={"ic s"} />
        {" The starting drafts are plain-language templates for a Canadian immigration consultancy, based on the Privacy Commissioner of Canada’s PIPEDA guidance. They are not legal advice. Review them against your practice and retainer agreement before you publish."}
        {data.contactMissing ? " Your firm has no privacy contact on file, so the drafts leave a blank for it." : ""}
      </p>
    </>
  );
}

/** One publish dialog per kind. The text starts from the published version, or from the draft. */
export function PortalPolicyDialog({ data }: { data: PolicyDialogData }) {
  const { id } = POLICY_DIALOG[data.kind];
  const k = data.kind === "portal_terms" ? "pT" : "pP";
  return (
    <dialog className={"dlg wide"} id={id} aria-labelledby={`${id}H`}>
      <div className={"dh"}>
        <h2 id={`${id}H`}>{`Publish the ${POLICY_NAME[data.kind].toLowerCase()}`}</h2>
        <button className={"x"} aria-label={"Close"} data-close={id}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        <div className={"alert warn"} style={{ marginBottom: "12px" }}>
          <Icon name={"info"} />
          <div>
            <b>{"Review this text before you publish"}</b>
            {data.draft
              ? "This is a starting draft, not legal advice. Check it against your practice and your retainer agreement, and fill in every part in square brackets."
              : "This is your current published version. Edit it and give it a new version label. It is not legal advice."}
          </div>
        </div>
        <div className={"fld"}>
          <label htmlFor={`${k}V`}>{"Version"}</label>
          <input className={"inp"} id={`${k}V`} type={"text"} defaultValue={data.versionLabel} maxLength={40} />
          <span className={"hint"}>{"Letters, numbers, dots, dashes or underscores. Each version can be published once."}</span>
        </div>
        <div className={"fld"}>
          <label htmlFor={`${k}N`}>{"Title"}</label>
          <input className={"inp"} id={`${k}N`} type={"text"} defaultValue={data.title} maxLength={200} />
        </div>
        <div className={"fld"}>
          <label htmlFor={`${k}B`}>{"Text clients read"}</label>
          <textarea className={"ta"} id={`${k}B`} rows={16} defaultValue={data.body} maxLength={POLICY_BODY_MAX} aria-describedby={`${k}B-h`}></textarea>
          <span className={"hint"} id={`${k}B-h`}>
            {`Plain text, up to ${POLICY_BODY_MAX.toLocaleString("en-CA")} characters.`}
          </span>
        </div>
        <p className={"why"}>
          <Icon name={"shield"} cls={"ic s"} />
          {"Published text can’t be changed. Publishing asks you to confirm it’s you."}
        </p>
      </div>
      <div className={"df"}>
        <button className={"btn"} data-close={id}>
          {"Cancel"}
        </button>
        <button className={"btn p"} data-policy={data.kind} data-org={data.organizationId}>
          {"Publish"}
        </button>
      </div>
    </dialog>
  );
}

export function PortalPoliciesAfter({ dialogs }: { dialogs: PolicyDialogData[] }) {
  return (
    <>
      {dialogs.map((dialog) => (
        <PortalPolicyDialog key={dialog.kind} data={dialog} />
      ))}
    </>
  );
}

/**
 * The honest warning where invitations start (Home and the matter's invite dialog): clients
 * can't accept until both documents are published. `kinds` are the missing ones.
 */
export function PolicyMissingAlert({ kinds, style }: { kinds: readonly PolicyKind[]; style?: React.CSSProperties }) {
  const what =
    kinds.length >= POLICY_KINDS.length
      ? "the portal terms of use and privacy notice"
      : `the ${POLICY_NAME[kinds[0]].toLowerCase()}`;
  return (
    <div className={"alert warn"} style={style}>
      <Icon name={"alert"} />
      <div>
        <b>{"Clients can’t accept portal invitations yet"}</b>
        {`Your firm hasn’t published ${what}. An invited client stops at the accept screen until you do. `}
        <a className={"tl"} href={POLICY_PAGE}>
          {"Review and publish"}
        </a>
      </div>
    </div>
  );
}

