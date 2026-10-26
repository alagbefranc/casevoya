import type { CSSProperties } from "react";
import type { PortalDenied as Denied, PortalPart } from "@/modules/portal/states";
import { DENIED_COPY, partList } from "@/modules/portal/states";

/**
 * DES-04 states for the client portal, built only from the Designer's parts: the empty panel
 * (`.panel .emp` with its `.emp-a` actions, use-portal.ts EMPTY), the `.alert warn` banner and the
 * page heading (`.ph`). Live-only additions; no new classes or styles.
 */

const SPRITE = "/assets/icons-coreui/sprite.svg";

function Glyph({ name }: { name: string }) {
  return (
    <svg className="ic" aria-hidden="true">
      <use href={`${SPRITE}#i-${name}`} />
    </svg>
  );
}

/**
 * A record the person can't see (another person's invoice, a receipt or form that isn't theirs, a
 * link from someone else's email): said plainly, never a blank page or another record in its place.
 */
export function PortalDenied({ what, firm }: { what: Denied; firm: string }) {
  const copy = DENIED_COPY[what];
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}>
        <div>
          <h1 className="display">{copy.title}</h1>
          <p>{copy.lead(firm)}</p>
        </div>
      </div>
      <div className="panel" data-state="denied">
        <div className="emp">
          <b>{copy.title}</b>
          <small>{copy.body(firm)}</small>
          <div className="emp-a">
            <a className="btn p sm" href={copy.back.href}>{copy.back.label}</a>
            <a className="btn sm" href="/portal/messages">Ask {firm}</a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The same, as a banner over the page the person landed on instead (their current matter, their threads). */
export function DeniedNotice({ what, firm }: { what: Denied; firm: string }) {
  const copy = DENIED_COPY[what];
  return (
    <div className="alert warn" role="alert" data-state="denied">
      <Glyph name="lock" />
      <div>
        <b>{copy.title}</b>
        {copy.body(firm)}
      </div>
    </div>
  );
}

/**
 * The page's own records couldn't be read (the database didn't answer): said plainly with a retry,
 * never shown as "nothing here", which would be an invented result.
 */
export function PortalUnavailable({ title, part, href }: { title: string; part: string; href: string }) {
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}>
        <div><h1 className="display">{title}</h1></div>
      </div>
      <div className="panel" data-state="unavailable">
        <div className="emp">
          <b>{`Your ${part} couldn’t be shown just now`}</b>
          <small>Nothing was lost, and nothing here means there are none. Try again in a moment.</small>
          <div className="emp-a"><a className="btn p sm" href={href}>Try again</a></div>
        </div>
      </div>
    </div>
  );
}

/** Some of the page loaded and some didn't: which parts are missing, so what's shown isn't read as complete. */
export function PartialNotice({ parts }: { parts: PortalPart[] }) {
  if (!parts.length) return null;
  return (
    <div className="alert warn" role="status" data-state="partial">
      <Glyph name="alert" />
      <div>
        <b>Part of this page couldn’t be loaded</b>
        {`${partList(parts)} couldn’t be shown just now, so what you see may be incomplete. Nothing was lost. Reload the page to try again.`}
      </div>
    </div>
  );
}
