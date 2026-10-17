import type { ReactNode } from "react";
import { AccountForm } from "./account-form";
import { DocumentsLive } from "./documents-live";
import { WithdrawShare } from "./withdraw-share";
import type { PortalDocuments } from "@/modules/documents/load";
import type { PortalViewer } from "@/modules/portal/load";

const NAV = [
  ["home", "Home", "/portal"],
  ["folder", "My matters", "/portal/matters"],
  ["check-circle", "Tasks", "/portal/tasks"],
  ["file", "Documents", "/portal/documents"],
  ["message", "Messages", "/portal/messages"],
  ["calendar", "Appointments", "/portal/appointments"],
  ["signature", "Agreements", "/portal/agreements"],
  ["credit-card", "Payments", "/portal/payments"],
] as const;

function icon(name: string) {
  return (
    <svg className="ic" aria-hidden="true">
      <use href={`/assets/icons-coreui/sprite.svg#i-${name}`} />
    </svg>
  );
}

export function LivePortal({
  page,
  viewer,
  documents,
}: {
  page: string;
  viewer: PortalViewer;
  documents?: PortalDocuments | null;
}) {
  const name = viewer.person?.displayName ?? "Your account";
  const matter = viewer.matters[0];
  const current = page === "home" ? "/portal" : `/portal/${page}`;
  return (
    <>
      <a className="sr" href="#main">Skip to content</a>
      <header className="mhead">
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>{viewer.organizationName}</span>
        <button aria-label="Open menu" aria-expanded="false" style={{ color: "#fff", padding: 8 }} id="mOpen">{icon("menu")}</button>
      </header>
      <div className="frame">
        <aside className="side" id="side" aria-label="Portal">
          <div className="brand" style={{ justifyContent: "flex-start", gap: 12, fontWeight: 500, color: "#fff", fontSize: 15 }}>
            {viewer.organizationName}
            <button id="mClose" aria-label="Close menu" style={{ marginLeft: "auto", color: "#8b8680" }}>{icon("close")}</button>
          </div>
          {matter ? <a className="mx" href="/portal/matters">{matter.title}</a> : null}
          <nav className="nav" id="pnav">
            {NAV.map(([glyph, label, href]) => (
              <a key={href} href={href} className={href === current ? "on" : undefined} aria-current={href === current ? "page" : undefined}>
                {icon(glyph)}
                <span>{label}</span>
              </a>
            ))}
          </nav>
          <div className="me" style={{ flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
            <span>{name}<small style={{ display: "block", color: "#8b8680", fontSize: 13 }}>{viewer.person?.role ?? viewer.role.replaceAll("_", " ")}</small></span>
            <a className="whois" href="/portal/account">Your account</a>
            <a className="whois" href="/portal/family">People on your file</a>
            <small style={{ color: "#8b8680", fontSize: 13, lineHeight: 1.5 }}>Powered by Casevoya · your file belongs to {viewer.organizationName}</small>
          </div>
        </aside>
        <main className="sheet">
          <div className="main" id="main">
            <header className="top">
              <span className="pill">{matter ? matter.title : viewer.organizationName}</span>
              <span className="acts"><a className="btn s sm" href="/help/client-home-screen" id="help">Help</a></span>
            </header>
            <LiveMain page={page} viewer={viewer} documents={documents ?? null} />
          </div>
        </main>
        <footer className="statusbar">
          <span><a href="#" id="lang">English · Français</a></span>
          <span>Times in your timezone: {viewer.timezone}</span>
        </footer>
      </div>
      <div className="scrimd" id="scrimd" />
    </>
  );
}

function LiveMain({
  page,
  viewer,
  documents,
}: {
  page: string;
  viewer: PortalViewer;
  documents: PortalDocuments | null;
}) {
  if (page === "documents" || page === "upload") {
    return documents ? <DocumentsLive page={page} viewer={viewer} documents={documents} /> : <Stub page={page} />;
  }
  if (page === "home" || page === "matters") return <MatterList viewer={viewer} home={page === "home"} />;
  if (page === "family" || page === "rafael" || page === "olena") return <People viewer={viewer} />;
  if (page === "guardian") return <Guardian viewer={viewer} />;
  if (page === "account") return <Account viewer={viewer} />;
  if (page === "intake" || page === "correction") return <Sections viewer={viewer} correction={page === "correction"} />;
  return <Stub page={page} />;
}

function MatterList({ viewer, home }: { viewer: PortalViewer; home: boolean }) {
  return (
    <div id="pc">
      <div className="ph"><h1 className="display">{home ? `Hi ${viewer.person?.displayName.split(" ")[0] ?? ""}.`.trim() : "My matters"}</h1>
        <p>{home ? "Here’s what is open on your file." : "Applications your firm has opened for you."}</p>
      </div>
      {viewer.matters.length === 0 ? <Empty title="No matters yet" copy="When your firm opens an application, it appears here." /> : viewer.matters.map((matter) => (
        <a className="mcard" key={matter.id} href="/portal/documents">
          <div>
            <h3>{matter.title}</h3>
            <p className="lbl">{matter.onHold ? "On hold" : matter.stage}</p>
          </div>
        </a>
      ))}
    </div>
  );
}

function People({ viewer }: { viewer: PortalViewer }) {
  return (
    <div id="pc">
      <div className="ph"><h1 className="display">People on your file</h1><p>Names come from your firm’s records.</p></div>
      {viewer.people.length === 0 ? <Empty title="No people yet" copy="People appear here when your firm adds them to a matter." /> : (
        <div className="who">
          {viewer.people.map((person) => (
            <div key={person.id}>
              <b>{person.displayName}</b>
              <small>{person.role ?? (person.isMinor ? "Minor" : "Person")}</small>
            </div>
          ))}
        </div>
      )}
      <Shares viewer={viewer} />
    </div>
  );
}

function Guardian({ viewer }: { viewer: PortalViewer }) {
  const grants = viewer.grants.filter((grant) => grant.kind === "guardian");
  return (
    <div id="pc">
      <div className="ph"><h1 className="display">Guardian access</h1><p>Who may act for a minor, and which sections are shared.</p></div>
      {grants.length === 0 ? <Empty title="No guardian grants" copy="A guardian grant appears here when your firm records one." /> : grants.map((grant) => (
        <div className="li" key={grant.id}><div><b>{grant.granteeName}</b><small>For {grant.subjectName} · {grant.purpose}</small></div></div>
      ))}
      <Shares viewer={viewer} />
    </div>
  );
}

function Shares({ viewer }: { viewer: PortalViewer }) {
  if (!viewer.shares.length) return null;
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2>Shared sections</h2>
      <div className="pad">
        {viewer.shares.map((share) => (
          <div className="li" key={share.id}>
            <div><b>{share.sectionKey}</b><small>{share.subjectName} shared with {share.granteeName} · {share.matterTitle}</small></div>
            <WithdrawShare organizationId={viewer.organizationId} shareId={share.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Account({ viewer }: { viewer: PortalViewer }) {
  const person = viewer.person;
  return (
    <div id="pc">
      <div className="ph"><h1 className="display">Your account</h1><p>Contact choices are saved on your person record.</p></div>
      {person ? (
        <AccountForm organizationId={viewer.organizationId} name={person.displayName} email={person.email} phone={person.phone} prefs={viewer.prefs} />
      ) : (
        <Empty title="No person record" copy="Your login isn’t linked to a person in this firm yet." />
      )}
    </div>
  );
}

function Sections({ viewer, correction }: { viewer: PortalViewer; correction: boolean }) {
  return (
    <div id="pc">
      <div className="ph">
        <h1 className="display">{correction ? "Request a correction" : "Your information"}</h1>
        <p>{correction ? "A correction becomes a new version of an answer. That workflow isn’t available yet." : "Sections your firm has recorded."}</p>
      </div>
      {viewer.sections.length === 0 ? (
        <Empty title={correction ? "Nothing to correct yet" : "No sections recorded"} copy={correction ? "A correction becomes a new version of an answer. That step isn’t available yet." : "Recorded answers appear here."} />
      ) : viewer.sections.map((section) => (
        <div className="li" key={section.id}><div><b>{section.sectionKey}</b><small>{section.personName} · {section.matterTitle} · {section.summary}</small></div></div>
      ))}
    </div>
  );
}

function Stub({ page }: { page: string }) {
  const copy: Record<string, [string, string]> = {
    tasks: ["No tasks yet", "Tasks aren’t stored yet. Your firm will email you when something needs you."],
    documents: ["No documents yet", "When your firm asks for a document, it appears here."],
    upload: ["Nothing to upload", "Your firm has not requested a document."],
    messages: ["No messages yet", "Messages aren’t stored yet."],
    appointments: ["No appointments yet", "Appointments aren’t stored yet."],
    agreements: ["No agreements yet", "E-sign isn’t connected yet."],
    payments: ["Nothing to pay", "Invoices aren’t stored yet. Nothing is due here."],
    pay: ["Payment isn’t connected", "The card form is on the demo invoice. A live invoice can’t be charged yet."],
  };
  const [title, body] = copy[page] ?? ["Not available yet", "This part of the portal isn’t connected yet."];
  return (
    <div id="pc">
      <div className="ph"><h1 className="display">{title}</h1></div>
      <Empty title={title} copy={body} />
    </div>
  );
}

function Empty({ title, copy }: { title: string; copy: string }): ReactNode {
  return (
    <div className="panel">
      <div className="emp"><b>{title}</b><small>{copy}</small></div>
    </div>
  );
}
