import type { CSSProperties, ReactNode } from "react";
import { AccountForm } from "./account-form";
import { AgreementsLive } from "./agreements-live";
import { AppointmentsLive } from "./appointments-live";
import { ChatError, ChatView } from "@/components/messages/chat";
import { DocumentsLive } from "./documents-live";
import { IntakeLive } from "./intake-live";
import { TasksLive } from "./tasks-live";
import { PayLive } from "./pay-live";
import { PaymentsLive } from "./payments-live";
import { WithdrawShare } from "./withdraw-share";
import { PrintButton } from "./print-button";
import type { ReceiptView } from "@/modules/finance/portal-receipt";
import { accentInk } from "@/modules/firm-onboarding/firm-logo";
import { HOME_CSS } from "./markup/portal";
import { homeView, matterCards, type HomeView, type MatterCard } from "@/modules/portal/home-present";
import type { PortalAgreements } from "@/modules/agreements/load";
import type { PortalDocuments } from "@/modules/documents/load";
import type { PortalInvoices } from "@/modules/finance/portal-load";
import type { PortalViewer } from "@/modules/portal/load";
import type { PortalAppointments } from "@/modules/scheduling/portal-load";
import type { ChatData } from "@/modules/messages/present";
import type { PortalIntake } from "@/modules/intake/portal-load";
import type { PortalTask } from "@/modules/portal/tasks-load";
import type { PortalNotice } from "@/modules/portal/notices";
import { DismissNotice } from "./dismiss-notice";
import { AcknowledgeDelivery } from "./acknowledge-delivery";

export type PortalPayments = { data: PortalInvoices; invoiceId: string | null };

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

function icon(name: string, size?: "s") {
  return (
    <svg className={size ? `ic ${size}` : "ic"} aria-hidden="true">
      <use href={`/assets/icons-coreui/sprite.svg#i-${name}`} />
    </svg>
  );
}

/** The sidebar chrome every live page shares with the designs (logo tile, matter pill). */
/** The receipt page: the design's two columns (receipt card, then its actions). */
const RECEIPT_CSS =
  ".rcpt-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,440px);gap:24px;align-items:start}" +
  ".rcpt{padding:28px}.rcpt-head{display:flex;justify-content:space-between;gap:16px;padding-bottom:18px;border-bottom:1px solid var(--line);margin-bottom:22px}" +
  ".rcpt-head>span{text-align:right;white-space:nowrap}.rcpt-head small{display:block;color:var(--t2);font-size:13px;margin-top:4px}" +
  ".rcpt-amt{font-family:var(--font-erode),Georgia,serif;font-weight:300;font-size:38px;line-height:1.1;margin-bottom:8px}" +
  ".rcpt-rows{display:grid;gap:12px;margin:22px 0;font-size:14px}.rcpt-rows>div{display:grid;grid-template-columns:minmax(120px,180px) 1fr;gap:12px}" +
  ".rcpt-rows dt{color:var(--t2)}.rcpt-rows dd{margin:0}" +
  ".rcpt-note{display:flex;gap:8px;align-items:flex-start;border-top:1px solid var(--line);padding-top:16px;color:var(--t2);font-size:13px}" +
  ".rcpt-side{display:grid;gap:12px}.rcpt-side .btn{justify-content:center;width:100%}.rcpt-due{padding:16px 18px}.rcpt-due small{color:var(--t2);display:block}.rcpt-due p{margin-top:4px;font-size:14px}" +
  "@media (max-width:900px){.rcpt-grid{grid-template-columns:1fr}.rcpt{padding:20px}.rcpt-rows>div{grid-template-columns:1fr;gap:2px}}" +
  "@media print{.side,.mhead,.top,.statusbar,.rcpt-side,a.lbl{display:none!important}.rcpt-grid{grid-template-columns:1fr}}";

const CHROME_CSS =
  ".firmlogo{width:32px;height:32px;border-radius:9px;background:#fff;color:#111;display:grid;place-items:center;font-weight:600;font-size:13px;flex:none;overflow:hidden}" +
  ".firmlogo img{width:22px;height:22px;object-fit:contain;display:block}" +
  "@media (min-width:901px){#mClose{display:none}}" +
  ".mx{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:40px;padding:0 10px;border-radius:9px;background:#262626;color:#fff;font-weight:500;font-size:14.5px;margin:0 0 14px;text-decoration:none}" +
  ".mx>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".side .brand{padding:4px 2px 18px}";

/** Up to two initials, for a logo tile or an avatar without a picture. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "·";
}

function roleLabel(role: string | null | undefined): string {
  const text = (role ?? "").replaceAll("_", " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

/**
 * The firm's tile (ORG-01): its logo on white, or its initials on the firm colour (text in
 * whichever of white or near-black reads). Buttons keep Casevoya's blue either way.
 */
function FirmLogo({ name, logo, accent }: { name: string; logo: string | null; accent: string | null }) {
  const tint = !logo && accent ? { background: accent, color: accentInk(accent) } : undefined;
  return (
    <span className="firmlogo" style={tint}>
      {logo ? <img src={logo} alt="" width={22} height={22} /> : initials(name)}
    </span>
  );
}

export function LivePortal({
  page,
  viewer,
  documents,
  agreements,
  payments,
  appointments,
  messages,
  intake,
  tasks,
  taskCount,
  unread,
  home,
  logo,
  accent,
  matters,
  receipt,
  notices,
}: {
  page: string;
  viewer: PortalViewer;
  documents?: PortalDocuments | null;
  agreements?: PortalAgreements | null;
  payments?: PortalPayments | null;
  appointments?: PortalAppointments | null;
  /** The Messages page's data; null when it failed to load. */
  messages?: ChatData | null;
  /** Intake delivery: the person's intake forms (Background questions and Request a correction). */
  intake?: { data: PortalIntake; field: string | null } | null;
  /** Intake delivery: the person's own client tasks (the Tasks page). */
  tasks?: PortalTask[] | null;
  /** Open client tasks, intake requests included: the Designer's count on Tasks. */
  taskCount?: number;
  /** Messages to the client they haven't opened: the count on Messages. */
  unread?: number;
  /** The Home page's view (src/modules/portal/home-present.ts); empty when not loaded. */
  home?: HomeView | null;
  /** A short-lived link to the firm's logo, or null for its initials. */
  logo?: string | null;
  /** The firm colour (#RRGGBB) for the initials tile, or null. */
  accent?: string | null;
  /** The My matters cards (src/modules/portal/home-present.ts); built without tasks when not loaded. */
  matters?: MatterCard[] | null;
  /** The on-screen receipt (/portal/receipt?id=), or null when it can't be read. */
  receipt?: ReceiptView | null;
  /** ORG-06: the person's own notices (their consultant changed), shown on Home. */
  notices?: PortalNotice[] | null;
}) {
  const name = viewer.person?.displayName ?? "Your account";
  const matter = viewer.matters[0];
  const current = page === "home" ? "/portal" : `/portal/${page}`;
  const role = roleLabel(viewer.person?.role ?? viewer.role);
  const badges: Record<string, number> = { "/portal/tasks": taskCount ?? 0, "/portal/messages": unread ?? 0 };
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: page === "receipt" ? CHROME_CSS + RECEIPT_CSS : CHROME_CSS }} />
      <a className="sr" href="#main">Skip to content</a>
      <header className="mhead">
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}><FirmLogo name={viewer.organizationName} logo={logo ?? null} accent={accent ?? null} />{viewer.organizationName}</span>
        <button aria-label="Open menu" aria-expanded="false" style={{ color: "#fff", padding: 8 }} id="mOpen">{icon("menu")}</button>
      </header>
      <div className="frame">
        <aside className="side" id="side" aria-label="Portal">
          <div className="brand" style={{ justifyContent: "flex-start", gap: 12, fontWeight: 500, color: "#fff", fontSize: 15 }}>
            <FirmLogo name={viewer.organizationName} logo={logo ?? null} accent={accent ?? null} />
            {viewer.organizationName}
            <button id="mClose" aria-label="Close menu" style={{ marginLeft: "auto", color: "#8b8680" }}>{icon("close")}</button>
          </div>
          {matter ? (
            <a className="mx" href="/portal/matters" title={viewer.matters.length > 1 ? "Switch matter" : matter.title}>
              <span>{matter.title}</span>
              {viewer.matters.length > 1 ? <span>{icon("sort", "s")}</span> : null}
            </a>
          ) : null}
          <nav className="nav" id="pnav">
            {NAV.map(([glyph, label, href]) => (
              <a key={href} href={href} className={href === current ? "on" : undefined} aria-current={href === current ? "page" : undefined}>
                {icon(glyph)}
                <span>{label}</span>
                {badges[href] ? <span className="k b">{badges[href]}</span> : null}
              </a>
            ))}
          </nav>
          <div className="me" style={{ flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="av" aria-hidden="true">{initials(name)}</span>
              <span>{name}{role ? <small style={{ display: "block", color: "#8b8680", fontSize: 13 }}>{role}</small> : null}</span>
            </span>
            <span style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <a className="whois" href="/portal/account">Your account</a>
              <a className="whois" href="/portal/family">People on your file</a>
            </span>
            <small style={{ color: "#8b8680", fontSize: 13, lineHeight: 1.5 }}>Powered by Casevoya <span className="sep" aria-hidden="true"></span> your file belongs to {viewer.organizationName}</small>
          </div>
        </aside>
        <main className="sheet">
          <div className="main" id="main">
            <header className="top">
              <span className="pill">
                <span>
                  {matter ? matter.title : viewer.organizationName}
                  {matter?.reference ? (<> <span className="sep" aria-hidden="true"></span> {matter.reference}</>) : null}
                </span>
              </span>
              <span className="acts"><a className="btn s sm" href="/help/client-home-screen" id="help">{icon("help", "s")}Help</a></span>
            </header>
            <LiveMain page={page} viewer={viewer} documents={documents ?? null} agreements={agreements ?? null} payments={payments ?? null} appointments={appointments ?? null} messages={messages} intake={intake ?? null} tasks={tasks ?? null} home={home ?? null} matters={matters ?? null} receipt={receipt ?? null} notices={notices ?? null} />
          </div>
        </main>
        <footer className="statusbar">
          <span><a href="#" id="lang">English <span className="sep" aria-hidden="true"></span> Français</a></span>
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
  agreements,
  payments,
  appointments,
  messages,
  intake,
  tasks,
  home,
  matters,
  receipt,
  notices,
}: {
  page: string;
  viewer: PortalViewer;
  documents: PortalDocuments | null;
  agreements: PortalAgreements | null;
  payments: PortalPayments | null;
  appointments: PortalAppointments | null;
  messages?: ChatData | null;
  intake: { data: PortalIntake; field: string | null } | null;
  tasks: PortalTask[] | null;
  home: HomeView | null;
  matters: MatterCard[] | null;
  receipt: ReceiptView | null;
  notices: PortalNotice[] | null;
}) {
  // Messages: the chat view (redesigned as a chat view at the owner's request, 2026-10-18).
  if (page === "messages" && messages !== undefined) {
    return (
      <div id="pc">
        <div className="ph pp-h rv" style={{ "--i": "0", marginBottom: 18 } as CSSProperties}>
          <div>
            <h1 className="display">Messages</h1>
            <p>Write to {viewer.organizationName} any time. Before you send, you’ll always see who can read it.</p>
          </div>
        </div>
        {messages ? <ChatView data={messages} /> : <ChatError />}
        <p className="lbl" style={{ marginTop: 14 }}>Messages aren’t legal advice until your consultant says so. For an urgent deadline, call {viewer.organizationName}.</p>
      </div>
    );
  }
  if (page === "appointments") {
    return appointments ? <AppointmentsLive viewer={viewer} data={appointments} /> : <Stub page={page} />;
  }
  if (page === "payments") {
    return payments ? <PaymentsLive viewer={viewer} data={payments.data} /> : <Stub page={page} />;
  }
  if (page === "pay") {
    const invoice = payments?.data.invoices.find((row) => row.id === payments.invoiceId);
    if (!payments || !invoice) return <Stub page={page} />;
    return (
      <PayLive
        invoice={invoice}
        organizationId={viewer.organizationId}
        firmName={viewer.organizationName}
        billedTo={viewer.person?.displayName ?? "You"}
        publishableKey={payments.data.publishableKey}
        payable={payments.data.payable}
      />
    );
  }
  if (page === "documents" || page === "upload") {
    return documents ? <DocumentsLive page={page} viewer={viewer} documents={documents} /> : <Stub page={page} />;
  }
  if (page === "agreements") {
    return agreements ? <AgreementsLive viewer={viewer} agreements={agreements} /> : <Stub page={page} />;
  }
  if (page === "receipt") return receipt ? <LiveReceipt view={receipt} /> : <Stub page={page} />;
  if (page === "home") return <LiveHome viewer={viewer} view={home ?? emptyHome(viewer)} notices={notices ?? []} />;
  if (page === "matters") {
    return <LiveMatters viewer={viewer} cards={matters ?? matterCards({ matters: viewer.matters, tasks: [], consultants: new Map(), timezone: viewer.timezone })} />;
  }
  if (page === "family" || page === "rafael" || page === "olena") return <People viewer={viewer} />;
  if (page === "guardian") return <Guardian viewer={viewer} />;
  if (page === "account") return <Account viewer={viewer} />;
  if ((page === "intake" || page === "correction") && intake) return <IntakeLive viewer={viewer} data={intake.data} correction={page === "correction"} field={intake.field} />;
  if (page === "intake" || page === "correction") return <Sections viewer={viewer} correction={page === "correction"} />;
  if (page === "tasks" && tasks) return <TasksLive viewer={viewer} tasks={tasks} />;
  return <Stub page={page} />;
}

/** A receipt on screen, laid out as design/portal/portal-receipt.png, with its PDF. */
function LiveReceipt({ view }: { view: ReceiptView }) {
  return (
    <div id="pc">
      <a className="lbl" href="/portal/payments" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 12 }}>{icon("chevron-left", "s")}Payments</a>
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}>
        <div>
          <h1 className="display">Receipt {view.number}</h1>
          <p>Proof of what you paid {view.firm}. Keep it for your records; it’s always here.</p>
        </div>
      </div>
      <div className="rcpt-grid">
        <section className="panel rcpt rv" style={{ "--i": "1" } as CSSProperties} aria-label={`Receipt ${view.number}`}>
          <div className="rcpt-head">
            <b>{view.rows.find(([term]) => term === "Paid to")?.[1]}</b>
            <span><b>{view.number}</b><small>{view.date}</small></span>
          </div>
          <div className="rcpt-amt">{view.amount}</div>
          <span className="bd ok"><i></i>Paid</span>
          <dl className="rcpt-rows">
            {view.rows.map(([term, value]) => (
              <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <p className="rcpt-note">{icon("lock", "s")}{view.note}</p>
          {view.sample ? <p className="lbl">Fictional sample. Not a client record.</p> : null}
        </section>
        <aside className="rcpt-side">
          <a className="btn p blk" href={view.pdfHref}>{icon("download", "s")}Download PDF</a>
          <PrintButton className="btn blk">{icon("print", "s")}Print</PrintButton>
          {view.invoiceHref ? <a className="btn blk" href={view.invoiceHref}>{icon("file", "s")}See {view.invoiceNumber}</a> : null}
          {view.stillToPay ? (
            <div className="panel rcpt-due">
              <small>Still to pay</small>
              <p>{view.stillToPay.line} <a href={view.stillToPay.href} style={{ textDecoration: "underline" }}>Pay now</a></p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** Home with nothing loaded: the calm hero and empty panels. */
function emptyHome(viewer: PortalViewer): HomeView {
  return homeView({
    firmName: viewer.organizationName,
    personName: viewer.person?.displayName ?? null,
    timezone: viewer.timezone,
    now: new Date(),
    matter: viewer.matters[0] ?? null,
    consultant: null,
    tasks: [],
    documents: [],
    invoices: [],
    messages: null,
  });
}

/** The client's Home, laid out as design/portal/pages/portal.html (HomeMarkup), from their own records. */
function LiveHome({ viewer, view, notices }: { viewer: PortalViewer; view: HomeView; notices: PortalNotice[] }) {
  const hello = view.firstName ? `Hi ${view.firstName}.` : "Hi.";
  const step = { done: "d", current: "c", todo: "" } as const;
  return (
    <div id="pc">
      {/* The design indents Payments under Messages on a phone; stacked, both start at the edge. */}
      <style dangerouslySetInnerHTML={{ __html: `${HOME_CSS}@media (max-width:900px){.pm>div+div{padding-left:0}}` }} />
      <div className="ph" style={{ marginBottom: 22 }}>
        <h1 className="display" id="hi">{hello}</h1>
        <p>Here’s what to do next, and where your application stands.</p>
      </div>
      {notices.map((notice) => (
        <div key={notice.id} className="alert info rv" role="status" style={{ marginBottom: 16, alignItems: "center" }}>
          {icon("info")}
          <div style={{ flex: 1 }}>
            <b>{notice.title}</b>
            {notice.body}
          </div>
          <DismissNotice organizationId={viewer.organizationId} noticeId={notice.id} />
        </div>
      ))}
      <section className={view.next.calm ? "next rv calm" : "next rv"} style={{ "--i": "1" } as CSSProperties}>
        <img className="nx-vo" src="/assets/vo/vo-point-96.png" srcSet="/assets/vo/vo-point-192.png 2x" width={56} height={56} alt="" />
        <div>
          <small>{view.next.eyebrow}</small>
          <h2>{view.next.title}</h2>
          <p>{view.next.body}</p>
        </div>
        <a className="btn" href={view.next.href}>{view.next.action}</a>
      </section>
      <div className="q4 panel rv" style={{ "--i": "2" } as CSSProperties}>
        <div><small>What do I need to do?</small><b>{view.strip.todo}</b></div>
        <div><small>By when?</small><b>{view.strip.byWhen}</b></div>
        <div>
          <small>Who is working on it?</small>
          <b style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="av" aria-hidden="true">{initials(view.strip.who)}</span>{view.strip.who}</b>
        </div>
        <div><small>What happens next?</small><b>{view.strip.whatNext}</b></div>
      </div>
      {view.steps ? (
        <>
          <h3 style={{ fontSize: 14, fontWeight: 500, margin: "4px 0 6px" }}>Where things stand</h3>
          <div className="steps" id="steps">
            {view.steps.map((item) => (
              <div key={item.label} className={step[item.state]} aria-current={item.state === "current" ? "step" : undefined}><span>{item.label}</span></div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: "var(--t2)", margin: "8px 0 24px" }}>
            Updates here are recorded by {viewer.organizationName}. There’s no live link to IRCC, and nothing here is a decision.
          </p>
        </>
      ) : null}
      {view.government?.length ? (
        <div className="panel rv" style={{ "--i": "3", marginBottom: 24 } as CSSProperties} id="gov">
          <h2>Updates from {viewer.organizationName}</h2>
          <div className="rank">
            {view.government.map((record, index) => (
              <div key={index}>
                {icon("info", "s")}
                <span>
                  <b style={{ fontWeight: 500, display: "block" }}>{record.title}</b>
                  {record.lines.map((line) => <span key={line} style={{ display: "block", fontSize: 14 }}>{line}</span>)}
                  <small style={{ display: "block", color: "var(--t2)", fontSize: 13, marginTop: 4 }}>{record.recorded}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {view.renewals?.length ? (
        <div className="panel rv" style={{ "--i": "3", marginBottom: 24 } as CSSProperties} id="renewals">
          <h2>Renewal reminders</h2>
          <div className="rank">
            {view.renewals.map((renewal, index) => (
              <div key={index}>
                {icon("calendar", "s")}
                <span>
                  <b style={{ fontWeight: 500, display: "block" }}>{renewal.title}</b>
                  {renewal.lines.map((line) => <span key={line} style={{ display: "block", fontSize: 14 }}>{line}</span>)}
                  {renewal.timing ? (
                    <small style={{ display: "block", color: "var(--t2)", fontSize: 13, marginTop: 4 }}>
                      {renewal.timing.text} <a href={renewal.timing.href} target="_blank" rel="noopener noreferrer">Official page</a>, {renewal.timing.facts}
                    </small>
                  ) : null}
                  {renewal.fee ? (
                    <small style={{ display: "block", color: "var(--t2)", fontSize: 13, marginTop: 4 }}>
                      {renewal.fee.text} <a href={renewal.fee.href} target="_blank" rel="noopener noreferrer">IRCC fee list</a>
                    </small>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {view.followUp ? (
        <div className="panel rv" style={{ "--i": "3", marginBottom: 24 } as CSSProperties} id="decision">
          <h2>After your decision</h2>
          {view.followUp.summary ? (
            <>
              <h3>Summary of your conditions, from {viewer.organizationName}</h3>
              <p style={{ fontSize: 14, whiteSpace: "pre-wrap", margin: "0 0 6px" }}>{view.followUp.summary.body}</p>
              <small style={{ display: "block", color: "var(--t2)", fontSize: 13, marginBottom: 14 }}>{view.followUp.summary.line}</small>
            </>
          ) : null}
          {view.followUp.deliveries.length ? (
            <>
              <h3>Decision documents sent to you</h3>
              <div className="rank">
                {view.followUp.deliveries.map((row) => (
                  <div key={row.id}>
                    {icon("file", "s")}
                    <span style={{ flex: 1 }}>
                      <b style={{ fontWeight: 500, display: "block" }}>{row.title}</b>
                      <small style={{ display: "block", color: "var(--t2)", fontSize: 13 }}>{row.acknowledged ?? row.detail}</small>
                    </span>
                    <span className="r">
                      {row.acknowledged ? <span className="bd ok"><i></i>Received</span> : <AcknowledgeDelivery organizationId={viewer.organizationId} deliveryId={row.id} />}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="panel rv" style={{ "--i": "3" } as CSSProperties}>
        <h2>Documents you’ve sent<span className="r" style={{ fontSize: 13, color: "var(--t2)" }}>Uploaded and accepted are shown separately</span></h2>
        <div className="split" style={{ "--n": "2" } as CSSProperties} id="docs">
          <div>
            <h3>Accepted by your consultant</h3>
            <div className="rank">
              {view.docs.accepted.length ? view.docs.accepted.map((doc) => (
                <div key={doc.key}>{icon("check-circle", "s")}{doc.title}<span className="r"><span className="bd ok"><i></i>Accepted</span></span></div>
              )) : <div style={{ color: "var(--t2)" }}>Nothing accepted yet.</div>}
            </div>
          </div>
          <div>
            <h3>Uploaded, not yet accepted</h3>
            <div className="rank">
              {view.docs.pending.length ? view.docs.pending.map((doc) => (
                <div key={doc.key}>{icon(doc.tone === "chg" ? "alert" : "clock", "s")}{doc.title}<span className="r"><span className={`bd ${doc.tone}`}><i></i>{doc.label}</span></span></div>
              )) : <div style={{ color: "var(--t2)" }}>Nothing waiting for review.</div>}
            </div>
          </div>
        </div>
      </div>
      <div className="split pm" style={{ "--n": "2", gap: 24 } as CSSProperties}>
        <div>
          <h3 className="sub" style={{ fontWeight: 400, color: "var(--t2)", fontSize: 14 }}>Messages</h3>
          {view.message ? (
            <a className="li" href="/portal/messages">
              <span className="av" aria-hidden="true">{initials(view.message.author)}</span>
              <div><b>{view.message.author}</b><small>{view.message.preview}</small></div>
              <span className="r"><small className="num" style={{ color: "var(--t2)" }}>{view.message.when}</small></span>
            </a>
          ) : (
            <div className="li"><div><b>No messages yet</b><small>Write to {viewer.organizationName} from Messages.</small></div></div>
          )}
        </div>
        <div>
          <h3 className="sub" style={{ fontWeight: 400, color: "var(--t2)", fontSize: 14 }}>Payments</h3>
          {view.invoice ? (
            <div className="li">
              <div><b>{view.invoice.title}</b><small>{view.invoice.detail}</small></div>
              <span className="r"><b className="num">{view.invoice.amount}</b><a className="btn p sm" href={view.invoice.href}>Pay</a></span>
            </div>
          ) : (
            <div className="li"><div><b>Nothing to pay</b><small>Invoices from {viewer.organizationName} appear here.</small></div></div>
          )}
        </div>
      </div>
    </div>
  );
}

/** My matters, laid out as design/portal/pages/portal-matters.html: one card per matter. */
function LiveMatters({ viewer, cards }: { viewer: PortalViewer; cards: MatterCard[] }) {
  const step = { done: "d", current: "c", todo: "" } as const;
  const others = viewer.people.filter((person) => person.id !== viewer.person?.id).length;
  return (
    <div id="pc">
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}>
        <div>
          <h1 className="display">My matters</h1>
          <p>Each matter is one application {viewer.organizationName} is working on for you. Pick one to see its next step.</p>
        </div>
      </div>
      {cards.length === 0 ? <Empty title="No matters yet" copy="When your firm opens an application, it appears here." /> : null}
      {cards.map((card, index) => (
        <a className="mcard rv" style={{ "--i": String(index + 1) } as CSSProperties} href={card.href} key={card.id}>
          <div>
            {card.label ? <span className="lbl">{card.label}</span> : null}
            <h3>{card.title}</h3>
            <p style={{ color: "var(--t2)", fontSize: 14, marginTop: 4 }}>{card.withLine}</p>
            {card.steps ? (
              <div className="steps">
                {card.steps.map((item) => (
                  <div key={item.label} className={step[item.state]}><span>{item.label}</span></div>
                ))}
              </div>
            ) : null}
          </div>
          <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
            <span className={`bd ${card.badge.tone}`}><i></i>{card.badge.text}</span>
            {card.consultant ? (
              <span className="lbl" style={{ display: "flex", gap: 8, alignItems: "center" }}><span className="av" aria-hidden="true">{initials(card.consultant)}</span>{card.consultant}</span>
            ) : null}
            {card.note ? <span className="lbl">{card.note}</span> : null}
            {card.closed ? null : <span className="btn p sm">Open</span>}
          </div>
        </a>
      ))}
      {others > 0 ? (
        <div className="alert info rv" style={{ "--i": String(cards.length + 1) } as CSSProperties}>
          {icon("info")}
          <div>
            <b>Why some people see less</b>
            Others on your file each have their own login. They see what they share with you, not your private records.{" "}
            <a href="/portal/family" style={{ textDecoration: "underline" }}>See who’s on your file</a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const FAMILY_ART = (
  <span className="art" style={{ "--a": "52px" } as CSSProperties} aria-hidden="true">
    <img src="/assets/generated/b2/family-tags-160@1x.webp" srcSet="/assets/generated/b2/family-tags-160@2x.webp 2x" width={52} height={52} alt="" loading="lazy" decoding="async" />
  </span>
);

/** What each person on the file sees, in their own words. */
function roleLine(person: PortalViewer["people"][number], self: boolean): string {
  const role = roleLabel(person.role) || (person.isMinor ? "Minor" : "Person");
  if (self) return `${role} · you`;
  if (person.isMinor) return `${role} · a parent or guardian manages their records`;
  return `${role} · their own login, tasks and private records`;
}

/**
 * People on your file, laid out as design/portal/pages/portal-family.html: one card per person,
 * "Who sees what" from the sections people actually shared, then those shares to withdraw.
 */
function People({ viewer }: { viewer: PortalViewer }) {
  const self = viewer.person?.id ?? null;
  const people = [...viewer.people].sort((a, b) => Number(b.id === self) - Number(a.id === self));
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
  const minors = people.some((person) => person.isMinor);
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}>
        {FAMILY_ART}
        <div>
          <h1 className="display">Each person has their own view</h1>
          <p>Everyone on your file signs in separately. They see shared information, their own tasks, and nothing private of anyone else’s.</p>
        </div>
      </div>
      {people.length === 0 ? <Empty title="No people yet" copy="People appear here when your firm adds them to a matter." /> : (
        <div className="who rv" style={{ "--i": "1" } as CSSProperties}>
          {people.map((person) => (
            <a key={person.id} href={person.id === self ? "/portal/account" : "#who-sees"}>
              <span className="av xl ini" aria-hidden="true">{initials(person.displayName)}</span>
              <b style={{ fontWeight: 500 }}>{person.id === self ? `You · ${person.displayName}` : person.displayName}</b>
              <small>{roleLine(person, person.id === self)}</small>
            </a>
          ))}
        </div>
      )}
      {people.length > 1 ? (
        <div className="panel rv" id="who-sees" style={{ "--i": "2", marginTop: 24 } as CSSProperties}>
          <h2>{icon("shield", "s")}Who sees what</h2>
          <div className="tw">
            <table className="t">
              <thead><tr><th>Record</th>{people.map((person) => <th key={person.id}>{person.id === self ? "You" : first(person.displayName)}</th>)}</tr></thead>
              <tbody>
                <tr><td>Next step and stages</td>{people.map((person) => <td key={person.id}><span className="bd ok"><i></i>Yes</span></td>)}</tr>
                {viewer.shares.map((share) => (
                  <tr key={share.id}>
                    <td>{share.subjectName}’s {share.sectionKey}</td>
                    {people.map((person) => {
                      const sees = person.displayName === share.subjectName || person.displayName === share.granteeName;
                      return <td key={person.id}><span className={sees ? "bd ok" : "bd unv"}><i></i>{sees ? "Yes" : "Hidden"}</span></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lbl pad">Each adult chooses what to share. {viewer.organizationName} sets the rest based on their role. Sharing a household or paying an invoice doesn’t change this.</p>
        </div>
      ) : null}
      <Shares viewer={viewer} />
      {minors ? (
        <div className="alert info rv" style={{ "--i": "3" } as CSSProperties}>
          {icon("users")}
          <div><b>Children under 18</b>A parent or legal guardian manages a minor’s records until they turn 18. <a href="/portal/guardian" style={{ textDecoration: "underline" }}>See guardian access</a></div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Guardian access, laid out as design/portal/pages/portal-guardian.html: who the signed-in person
 * acts for, and the authority the firm recorded for each.
 */
function Guardian({ viewer }: { viewer: PortalViewer }) {
  const grants = viewer.grants.filter((grant) => grant.kind === "guardian");
  const me = viewer.person?.displayName ?? null;
  const mine = grants.filter((grant) => grant.granteeName === me);
  const names = [...new Set(mine.map((grant) => grant.subjectName.trim().split(/\s+/)[0] ?? grant.subjectName))];
  const heading = names.length ? `You act for ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}` : "Guardian access";
  const minor = (name: string) => viewer.people.find((person) => person.displayName === name);
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}>
        {FAMILY_ART}
        <div>
          <h1 className="display">{heading}</h1>
          <p>
            {names.length
              ? `You’re recorded as their guardian on this file, so you see and manage their records. ${viewer.organizationName} checks this again as each child gets older.`
              : "Who may act for a minor, and which sections are shared."}
          </p>
        </div>
      </div>
      {grants.length === 0 ? <Empty title="No guardian grants" copy="A guardian grant appears here when your firm records one." /> : (
        <>
          <div className="who rv" style={{ "--i": "1" } as CSSProperties}>
            {me && mine.length ? (
              <a href="/portal/account">
                <span className="av xl ini" aria-hidden="true">{initials(me)}</span>
                <b style={{ fontWeight: 500 }}>You · {me}</b>
                <small>{roleLabel(viewer.person?.role) || "Person"} · guardian</small>
              </a>
            ) : null}
            {grants.map((grant) => (
              <a key={grant.id} href={`#grant-${grant.id}`}>
                <span className="av xl ini" aria-hidden="true">{initials(grant.subjectName)}</span>
                <b style={{ fontWeight: 500 }}>{grant.subjectName}</b>
                <small>{minor(grant.subjectName)?.isMinor ? "Minor" : "Person"} · {grant.granteeName === me ? "you manage their records" : `${grant.granteeName} manages their records`}</small>
              </a>
            ))}
          </div>
          {grants.map((grant, index) => (
            <div className="panel rv" id={`grant-${grant.id}`} key={grant.id} style={{ "--i": String(index + 2), marginTop: index === 0 ? 24 : undefined } as CSSProperties}>
              <h2>{icon("shield", "s")}{grant.granteeName === me ? "Your authority" : `${grant.granteeName}’s authority`}<span className="r"><span className="bd ok"><i></i>On file</span></span></h2>
              <div className="pad">
                <div className="kv">
                  <span>For</span><b>{grant.subjectName}</b>
                  <span>Guardian</span><b>{grant.granteeName}</b>
                  <span>Purpose</span><b>{grant.purpose}</b>
                </div>
                <p className="lbl" style={{ marginTop: 12 }}>
                  If a court order or custody change affects who can act for a child, tell {viewer.organizationName}. Access changes only after they review the new document.
                </p>
              </div>
            </div>
          ))}
        </>
      )}
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
            <div><b>{roleLabel(share.sectionKey)}</b><small>{share.subjectName} shared with {share.granteeName} · {share.matterTitle}</small></div>
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
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}><div><h1 className="display">Your account</h1><p>Your details, and what {viewer.organizationName} may send you. Changes here never touch your application answers.</p></div></div>
      {person ? (
        <AccountForm organizationId={viewer.organizationId} name={person.displayName} email={person.email} phone={person.phone} prefs={viewer.prefs} firm={viewer.organizationName} timezone={viewer.timezone} />
      ) : (
        <Empty title="No person record" copy="Your login isn’t linked to a person in this firm yet." />
      )}
      <div className="panel rv" style={{ "--i": "3", marginTop: 22 } as CSSProperties}>
        <h2>{icon("laptop", "s")}Signing in</h2>
        <div className="pad">
          <div className="li">
            <div><b>This device</b><small>You sign in with your email and a one-time code.</small></div>
            <span className="r">
              <form method="post" action="/sign-out">
                <button className="btn sm" type="submit">{icon("logout", "s")}Sign out</button>
              </form>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Intake or Correction when the forms couldn't be read: the designed heading, then what is on record. */
function Sections({ viewer, correction }: { viewer: PortalViewer; correction: boolean }) {
  return (
    <div id="pc">
      <div className="ph pp-h rv" style={{ "--i": "0" } as CSSProperties}>
        <div>
          <h1 className="display">{correction ? "Request a correction" : "Your questions"}</h1>
          <p>{correction ? "A correction is for answers you already sent." : `Forms ${viewer.organizationName} asked you to fill in.`}</p>
        </div>
      </div>
      <Empty title="Your forms couldn’t be shown just now" copy="Nothing was lost. Try again in a moment." />
      {viewer.sections.length ? (
        <div className="panel rv" style={{ "--i": "2", marginTop: 18 } as CSSProperties}>
          <h2>{icon("file", "s")}On record</h2>
          <div className="pad">
            {viewer.sections.map((section) => (
              <div className="li" key={section.id}><div><b>{roleLabel(section.sectionKey)}</b><small>{section.personName} · {section.matterTitle} · {section.summary}</small></div></div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stub({ page }: { page: string }) {
  const copy: Record<string, [string, string]> = {
    tasks: ["No tasks yet", "Your tasks couldn’t be shown just now. Try again in a moment."],
    documents: ["No documents yet", "When your firm asks for a document, it appears here."],
    upload: ["Nothing to upload", "Your firm has not requested a document."],
    messages: ["No messages yet", "Messages aren’t stored yet."],
    appointments: ["No appointments yet", "Appointments aren’t stored yet."],
    agreements: ["No agreements yet", "When your firm sends an agreement, it appears here."],
    payments: ["Nothing to pay", "When your firm sends an invoice, it appears here."],
    pay: ["Choose an invoice", "Open Payments and choose the invoice you want to pay."],
    receipt: ["Receipt not found", "Open Payments and choose the receipt you want to see."],
  };
  const [title, body] = copy[page] ?? ["Not available yet", "This part of the portal isn’t connected yet."];
  return (
    <div id="pc">
      <div className="ph"><h1 className="display">{title}</h1></div>
      <Empty title={title} copy={body} />
    </div>
  );
}

/** While a portal page loads: a quiet skeleton, never "No portal yet" (that is for no access). */
export function PortalLoading() {
  return (
    <main className="sheet">
      <div className="main" id="main" aria-busy="true">
        <div id="pc">
          <p className="sr" role="status">Opening your portal…</p>
          <div className="sk" style={{ width: 260, height: 36, margin: "8px 0 14px" }} />
          <div className="sk" style={{ width: "60%", height: 14 }} />
          <div className="sk" style={{ height: 180, borderRadius: 18, margin: "26px 0 18px" }} />
          <div className="sk" style={{ height: 76, borderRadius: 14 }} />
          <div className="sk" style={{ height: 140, borderRadius: 14, marginTop: 18 }} />
        </div>
      </div>
    </main>
  );
}

export function EmptyPortal() {
  return (
    <main className="sheet">
      <div className="main" id="main">
        <div id="pc">
          <div className="ph">
            <h1 className="display">No portal yet</h1>
            <p>When a firm invites you, your file appears here.</p>
          </div>
          <div className="panel">
            <div className="emp"><b>Nothing on file</b><small>This account isn’t linked to a client file.</small></div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Empty({ title, copy }: { title: string; copy: string }): ReactNode {
  return (
    <div className="panel">
      <div className="emp"><b>{title}</b><small>{copy}</small></div>
    </div>
  );
}
