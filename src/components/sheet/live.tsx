import type { ReactNode } from "react";
import Link from "next/link";
import { ActionForm } from "@/components/sheet/action-form";
import {
  governmentFromSheet,
  holdMatterFromSheet,
  outcomeFromSheet,
  stageMatterFromSheet,
  taskFromSheet,
  completeTaskFromSheet,
} from "@/modules/sheet/actions";
import { FinanceLive } from "@/components/sheet/finance-live";
import type { FinanceSnapshot } from "@/modules/finance/load";
import type { SheetBundle, SheetMatterRow } from "@/modules/sheet/load";
import {
  GOVERNMENT_STATUSES,
  MATTER_OUTCOMES,
  MATTER_STAGES,
  STAFF_ROLES,
  deadlineBadge,
  governmentLabel,
  invitationLabel,
  isoDateInTimeZone,
  matterMatches,
  mattersTitle,
  outcomeLabel,
  practiceCounts,
  roleLabel,
  slotFor,
  stageLabel,
  taskBadge,
  type MatterViewInput,
} from "@/modules/sheet/present";

const NAV: { group: string; items: [string, string][] }[] = [
  { group: "Work", items: [["/sheet", "Home"], ["/sheet/matters", "All matters"], ["/sheet/clients", "Clients"], ["/sheet/tasks", "Tasks"], ["/sheet/government", "Government status"], ["/sheet/queue", "Team queue"]] },
  { group: "Records", items: [["/sheet/inbox", "Inbox"], ["/sheet/documents", "Documents"], ["/sheet/agreements", "Agreements"], ["/sheet/finance", "Finance"]] },
  { group: "Practice", items: [["/sheet/calendar", "Calendar"], ["/sheet/pipeline", "Pipeline"], ["/sheet/consultations", "Consultations"], ["/sheet/reports", "Reports"], ["/sheet/templates", "Templates"], ["/sheet/intake-builder", "Intake forms"], ["/sheet/invitations", "People and invitations"], ["/sheet/licence", "Licences"], ["/sheet/roles", "Roles"], ["/sheet/grants", "Access grants"], ["/sheet/settings", "Settings"], ["/sheet/sample-mode", "Sample mode"]] },
  { group: "Compliance", items: [["/sheet/complaints", "Complaints"], ["/sheet/privacy", "Privacy requests"], ["/sheet/exports", "Exports"], ["/sheet/migration", "Migration"], ["/sheet/drafts", "Vo drafts"], ["/sheet/ai", "Vo and AI"], ["/sheet/states", "System states"]] },
];

function personName(bundle: SheetBundle, id: string | null): string {
  if (!id) return "—";
  return bundle.people.find((person) => person.id === id)?.name ?? "Person";
}

function matterTitle(bundle: SheetBundle, id: string | null): string {
  if (!id) return "—";
  return bundle.matters.find((matter) => matter.id === id)?.title ?? "Matter";
}

function viewOf(matter: SheetMatterRow, bundle: SheetBundle): MatterViewInput {
  const nextDue = bundle.deadlines.find((row) => row.matterId === matter.id && row.dueOn)?.dueOn ?? null;
  const pendingReview = bundle.documents.some((row) => row.matterId === matter.id && row.reviewState === "pending");
  return {
    onHold: matter.onHold,
    stage: matter.stage,
    nextDue,
    pendingReview,
    title: matter.title,
    reference: matter.reference,
  };
}

export function LiveSheet({
  bundle,
  page,
  tab,
  view,
  query,
  matterId,
  finance,
}: {
  bundle: SheetBundle;
  page: string;
  tab?: string;
  view?: string;
  query?: string;
  matterId?: string;
  finance?: FinanceSnapshot | null;
}) {
  const slot = page === "matter" || page === "settings" || page === "calendar" ? null : slotFor(page, tab);
  const today = isoDateInTimeZone(new Date(), bundle.staff.timezone);
  return (
    <>
      <div className="mhead">
        <Link href="/sheet"><img src="/assets/brand/casevoya-wordmark-white.svg" alt="Casevoya" width={126} height={20} /></Link>
        <span className="mi"><button id="mOpen" aria-label="Open menu" type="button"><svg className="ic" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-menu" /></svg></button></span>
      </div>
      <div className="frame">
        <aside className="side" id="side" aria-label="Main">
          <div className="brand">
            <Link href="/sheet"><img src="/assets/brand/casevoya-wordmark-white.svg" alt="Casevoya" width={126} height={20} /></Link>
            <button id="mClose" aria-label="Close menu" type="button"><svg className="ic" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-close" /></svg></button>
          </div>
          {NAV.map((group) => (
            <div className="grp" key={group.group}>
              <button type="button" aria-expanded="true"><span>{group.group}</span></button>
              <div className="tree">
                {group.items.map(([href, label]) => (
                  <Link key={href} href={href} className={href === `/sheet/${page}` || (page === "index" && href === "/sheet") || (page === "matter" && href === "/sheet/matters") ? "on" : ""}>{label}</Link>
                ))}
              </div>
            </div>
          ))}
          <div className="me"><div>{bundle.staff.displayName}<small>{roleLabel(bundle.staff.role)}</small></div></div>
        </aside>
        <main className="sheet">
          <div className="main" id="main">
            <header className="top">
              <span className="pill">{bundle.staff.organizationName}</span>
              <span className="pill">{bundle.staff.timezone}</span>
            </header>
            {bundle.error ? <div className="alert bad" role="alert"><div><b>Some records didn’t load</b>{bundle.error}</div></div> : null}
            <div id="content">
              {slot ? <Slot message={slot} /> : <Wired bundle={bundle} page={page} tab={tab} view={view} query={query} matterId={matterId} today={today} finance={finance ?? null} />}
            </div>
          </div>
        </main>
        <footer className="statusbar"><span><i className="dot"></i>Live firm</span><span>Times in {bundle.staff.timezone}</span></footer>
      </div>
      <div className="scrimd" id="scrimd"></div>
    </>
  );
}

function Slot({ message }: { message: string }) {
  return (
    <div className="panel" data-slot="unwired">
      <div className="emp">
        <b>Not connected</b>
        <small>{message}</small>
      </div>
    </div>
  );
}

function Wired({
  bundle,
  page,
  tab,
  view,
  query,
  matterId,
  today,
  finance,
}: {
  bundle: SheetBundle;
  page: string;
  tab?: string;
  view?: string;
  query?: string;
  matterId?: string;
  today: string;
  finance: FinanceSnapshot | null;
}) {
  if (page === "index") return <Home bundle={bundle} today={today} />;
  if (page === "matters") return <Matters bundle={bundle} view={view} query={query} today={today} />;
  if (page === "finance") return finance ? <FinanceLive organizationId={bundle.staff.organizationId} snapshot={finance} tab={tab} /> : <Slot message="Finance records didn’t load." />;
  if (page === "matter") return <Matter bundle={bundle} matterId={matterId} tab={tab} today={today} finance={finance} />;
  if (page === "tasks" || page === "queue") return <Tasks bundle={bundle} tab={tab} today={today} queue={page === "queue"} />;
  if (page === "calendar") return <Calendar bundle={bundle} tab={tab} />;
  if (page === "documents") return <Documents bundle={bundle} />;
  if (page === "agreements") return <Agreements bundle={bundle} />;
  if (page === "clients") return <People bundle={bundle} />;
  if (page === "invitations") return <Invites bundle={bundle} tab={tab} />;
  if (page === "grants") return <Grants bundle={bundle} />;
  if (page === "government") return <Government bundle={bundle} />;
  if (page === "licence" || page === "licence-suspended") return <Licences bundle={bundle} />;
  if (page === "settings" || page === "sample-mode") return <Settings bundle={bundle} tab={tab} page={page} finance={finance} />;
  if (page === "roles") return <Roles />;
  if (page === "templates" || page === "intake-builder") return <Templates bundle={bundle} />;
  if (page === "states") return <p>Open any Sheet screen with <span className="num">?state=loading</span>, empty, error, denied or offline.</p>;
  return <Slot message="This screen has no live records yet." />;
}

function Home({ bundle, today }: { bundle: SheetBundle; today: string }) {
  const counts = practiceCounts({
    tasks: bundle.tasks,
    documentsPending: bundle.documents.filter((row) => row.reviewState === "pending").length,
    mattersOnHold: bundle.matters.filter((row) => row.onHold).length,
    today,
  });
  const open = bundle.tasks.filter((task) => task.status === "open" || task.status === "blocked").slice(0, 8);
  return (
    <>
      <div className="ph"><h1 className="display">Good day, {bundle.staff.displayName}.</h1><p>{bundle.staff.organizationName}. Counts below are this firm’s records.</p></div>
      <div className="panel">
        <h2>Needs you</h2>
        <div className="rank">
          <Link href="/sheet/matters?view=due"><b className="num">{counts.dueToday}</b><span>tasks due today</span></Link>
          <Link href="/sheet/documents"><b className="num">{counts.awaitingReview}</b><span>documents awaiting review</span></Link>
          <Link href="/sheet/matters?view=blocked"><b className="num">{counts.blocked}</b><span>matters on hold</span></Link>
        </div>
      </div>
      <div className="panel">
        <h2>Open tasks</h2>
        {open.length === 0 ? <p>No open tasks.</p> : open.map((task) => (
          <Link className="li" key={task.id} href={task.matterId ? `/sheet/matters/${task.matterId}?tab=tasks` : "/sheet/tasks"}>
            <div><b>{task.title}</b><small>{matterTitle(bundle, task.matterId)} · {task.dueOn ?? "No date"}</small></div>
            <span className="r"><Badge {...taskBadge(task.status)} /></span>
          </Link>
        ))}
      </div>
      <Slot message="The Vo suggestion card is not connected. Drafts are not generated here." />
    </>
  );
}

function Matters({ bundle, view, query, today }: { bundle: SheetBundle; view?: string; query?: string; today: string }) {
  const rows = bundle.matters.filter((matter) => matterMatches(viewOf(matter, bundle), view, query, today));
  return (
    <>
      <div className="ph"><h1 className="display">{mattersTitle(view)}</h1><p>Stage and government status stay in separate columns.</p></div>
      <Table
        head={["Client file", "Reference", "Firm stage", "Government", "Next deadline", "Hold"]}
        rows={rows.map((matter) => [
          <Link key={matter.id} href={`/sheet/matters/${matter.id}`}>{matter.title}</Link>,
          matter.reference ?? "—",
          stageLabel(matter.stage),
          governmentLabel(matter.governmentStatus),
          viewOf(matter, bundle).nextDue ?? "—",
          matter.onHold ? "On hold" : "—",
        ])}
        empty="No matters match this view."
      />
    </>
  );
}

function Matter({ bundle, matterId, tab, today, finance }: { bundle: SheetBundle; matterId?: string; tab?: string; today: string; finance: FinanceSnapshot | null }) {
  const matter = bundle.matters.find((row) => row.id === matterId);
  if (!matter) {
    return <div className="panel"><div className="emp"><b>Matter not found</b><small>That file is not in this firm.</small></div></div>;
  }
  const current = tab || "overview";
  const tasks = bundle.tasks.filter((row) => row.matterId === matter.id);
  const docs = bundle.documents.filter((row) => row.matterId === matter.id);
  const agreements = bundle.agreements.filter((row) => row.matterId === matter.id);
  const deadlines = bundle.deadlines.filter((row) => row.matterId === matter.id);
  const intake = bundle.intake.filter((row) => row.matterId === matter.id);
  const audit = bundle.audit.filter((row) => row.objectTable === "matters");
  return (
    <>
      <div className="ph">
        <h1 className="display">{matter.title}</h1>
        <p>{matter.reference ?? "No reference yet"} · {stageLabel(matter.stage)} · {governmentLabel(matter.governmentStatus)}{matter.onHold ? ` · On hold (${matter.onHoldReason ?? "no reason"})` : ""}</p>
      </div>
      <div className="tabs" role="tablist">
        {["overview", "intake", "people", "documents", "agreements", "tasks", "decisions", "closure", "audit", "messages", "billing", "forms", "submissions", "timeline"].map((id) => (
          <Link key={id} href={`/sheet/matters/${matter.id}?tab=${id}`} role="tab" aria-selected={current === id}>{id}</Link>
        ))}
      </div>
      {slotFor("matter", current) ? <Slot message={slotFor("matter", current) ?? ""} /> : null}
      {current === "overview" ? (
        <>
          <div className="panel">
            <h2>Overview</h2>
            <p>Version {matter.version}. Updated {matter.updatedAt.slice(0, 10)}.</p>
            <MatterForms bundle={bundle} matter={matter} today={today} />
          </div>
          <Table head={["Deadline", "Kind", "Due", "Verification"]} rows={deadlines.map((row) => [row.label, row.kind, row.dueOn ?? "—", deadlineBadge(row.verification).label])} empty="No deadlines on this matter." />
        </>
      ) : null}
      {current === "intake" ? <Table head={["Person", "Status"]} rows={intake.map((row) => [personName(bundle, row.personId), row.status])} empty="No intake responses on this matter." /> : null}
      {current === "people" ? <Table head={["Person"]} rows={bundle.people.slice(0, 12).map((person) => [person.name])} empty="No people on file." /> : null}
      {current === "documents" ? <Table head={["Document", "Review"]} rows={docs.map((row) => [row.purpose, row.reviewState ?? "No version"])} empty="No documents linked to this matter." /> : null}
      {current === "agreements" ? <Table head={["Agreement", "Status"]} rows={agreements.map((row) => [row.title, row.status])} empty="No agreements on this matter." /> : null}
      {current === "billing" && finance ? <FinanceLive organizationId={bundle.staff.organizationId} snapshot={finance} matterId={matter.id} /> : null}
      {current === "tasks" ? (
        <>
          <Table head={["Task", "Due", "Status"]} rows={tasks.map((row) => [row.title, row.dueOn ?? "—", taskBadge(row.status).label])} empty="No tasks on this matter." />
          <ActionForm action={taskFromSheet} label="Add task">
            <HiddenOrg bundle={bundle} matter={matter} />
            <label className="fl">Title<input name="title" required /></label>
            <input type="hidden" name="audience" value="internal" />
            <input type="hidden" name="ownerMembershipId" value={bundle.staff.membershipId} />
            <label className="fl">Due<input type="date" name="dueOn" /></label>
          </ActionForm>
        </>
      ) : null}
      {current === "decisions" ? (
        <div className="panel">
          <h2>Outcome</h2>
          <p>{matter.outcome ? outcomeLabel(matter.outcome) : "No outcome recorded."}</p>
          <ActionForm action={outcomeFromSheet} label="Record outcome">
            <HiddenOrg bundle={bundle} matter={matter} />
            <label className="fl">Outcome<select name="outcome">{MATTER_OUTCOMES.map((item) => <option key={item} value={item}>{outcomeLabel(item)}</option>)}</select></label>
            <label className="fl">Note<textarea name="note" required /></label>
            <label className="fl">Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" required /></label>
          </ActionForm>
        </div>
      ) : null}
      {current === "closure" ? <div className="panel"><h2>Retention</h2><p>{matter.retentionOn ?? "No retention date yet."} Closing the file uses the recorded outcome and retention date.</p></div> : null}
      {current === "audit" || current === "timeline" ? <Table head={["When", "Action", "Result"]} rows={audit.map((row) => [row.occurredAt.slice(0, 16), row.action, row.result])} empty="No audit events loaded for matters." /> : null}
    </>
  );
}

function MatterForms({ bundle, matter, today }: { bundle: SheetBundle; matter: SheetMatterRow; today: string }) {
  return (
    <div className="split">
      <ActionForm action={stageMatterFromSheet} label="Change stage">
        <HiddenOrg bundle={bundle} matter={matter} />
        <label className="fl">Stage<select name="stage">{MATTER_STAGES.map((item) => <option key={item} value={item}>{stageLabel(item)}</option>)}</select></label>
        <label className="fl">Reason<textarea name="reason" required /></label>
        <label className="fl">Authenticator code<input name="code" required /></label>
      </ActionForm>
      <ActionForm action={holdMatterFromSheet} label="Put on hold">
        <HiddenOrg bundle={bundle} matter={matter} />
        <label className="fl">Reason<textarea name="reason" required /></label>
        <input type="hidden" name="ownerMembershipId" value={bundle.staff.membershipId} />
        <label className="fl">Review on<input type="date" name="reviewOn" defaultValue={today} required /></label>
        <label className="fl">Authenticator code<input name="code" required /></label>
      </ActionForm>
      <ActionForm action={governmentFromSheet} label="Record government status">
        <HiddenOrg bundle={bundle} matter={matter} />
        <label className="fl">Status<select name="status">{GOVERNMENT_STATUSES.map((item) => <option key={item} value={item}>{governmentLabel(item)}</option>)}</select></label>
        <label className="fl">Note<textarea name="note" required /></label>
        <label className="fl">Authenticator code<input name="code" required /></label>
      </ActionForm>
    </div>
  );
}

function HiddenOrg({ bundle, matter }: { bundle: SheetBundle; matter: SheetMatterRow }) {
  return (
    <>
      <input type="hidden" name="organizationId" value={bundle.staff.organizationId} />
      <input type="hidden" name="matterId" value={matter.id} />
      <input type="hidden" name="version" value={matter.version} />
    </>
  );
}

function Tasks({ bundle, tab, today, queue }: { bundle: SheetBundle; tab?: string; today: string; queue: boolean }) {
  const audience = tab === "client" ? "client" : tab === "deadlines" ? null : "internal";
  if (tab === "deadlines" || queue === false && tab === "deadlines") {
    return <Deadlines bundle={bundle} />;
  }
  const rows = bundle.tasks.filter((task) => (audience ? task.audience === audience : true) && task.status !== "cancelled");
  const grouped = queue
    ? bundle.members.map((member) => ({
        label: roleLabel(member.role),
        count: bundle.tasks.filter((task) => task.ownerMembershipId === member.id && task.status === "open").length,
      }))
    : [];
  return (
    <>
      <div className="ph"><h1 className="display">{queue ? "Team queue" : "Tasks"}</h1><p>Today is {today} in {bundle.staff.timezone}.</p></div>
      {queue ? <Table head={["Role", "Open tasks"]} rows={grouped.map((row) => [row.label, String(row.count)])} empty="No memberships." /> : null}
      <Table head={["Task", "Matter", "Due", "Status"]} rows={rows.map((task) => [task.title, matterTitle(bundle, task.matterId), task.dueOn ?? "—", taskBadge(task.status).label])} empty="No tasks." />
      {rows.filter((task) => task.status === "open").slice(0, 5).map((task) => (
        <ActionForm key={task.id} action={completeTaskFromSheet} label={`Mark done: ${task.title}`}>
          <input type="hidden" name="organizationId" value={bundle.staff.organizationId} />
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="version" value={task.version} />
        </ActionForm>
      ))}
    </>
  );
}

function Calendar({ bundle, tab }: { bundle: SheetBundle; tab?: string }) {
  const current = tab === "deadlines" ? "deadlines" : "week";
  const week = slotFor("calendar", "week");
  return (
    <>
      <div className="ph"><h1 className="display">Calendar</h1></div>
      <div className="tabs" role="tablist">
        <Link href="/sheet/calendar?tab=week" role="tab" aria-selected={current === "week"}>Week</Link>
        <Link href="/sheet/calendar?tab=deadlines" role="tab" aria-selected={current === "deadlines"}>Deadlines</Link>
      </div>
      {current === "deadlines" ? <Deadlines bundle={bundle} /> : <Slot message={week ?? ""} />}
    </>
  );
}

function Deadlines({ bundle }: { bundle: SheetBundle }) {
  return (
    <>
      <div className="ph"><h1 className="display">Deadlines</h1><p>A date stays unverified until a consultant confirms it.</p></div>
      <Table head={["Deadline", "Matter", "Kind", "Due", "Verification"]} rows={bundle.deadlines.map((row) => [row.label, matterTitle(bundle, row.matterId), row.kind, row.dueOn ?? "—", deadlineBadge(row.verification).label])} empty="No deadlines recorded." />
    </>
  );
}

function Documents({ bundle }: { bundle: SheetBundle }) {
  return (
    <>
      <div className="ph"><h1 className="display">Documents</h1><p>Accepted and awaiting review stay separate.</p></div>
      <Table head={["Purpose", "Person", "Upload", "Review"]} rows={bundle.documents.map((row) => [row.purpose, personName(bundle, row.personId), row.uploadState ?? "—", row.reviewState ?? "—"])} empty="No documents." />
    </>
  );
}

function Agreements({ bundle }: { bundle: SheetBundle }) {
  return (
    <>
      <div className="ph"><h1 className="display">Agreements</h1><p>Envelopes are the firm’s e-sign records.</p></div>
      <Table head={["Agreement", "Matter", "Kind", "Status"]} rows={bundle.agreements.map((row) => [row.title, matterTitle(bundle, row.matterId), row.kind, row.status])} empty="No agreements." />
    </>
  );
}

function People({ bundle }: { bundle: SheetBundle }) {
  return (
    <>
      <div className="ph"><h1 className="display">Clients</h1></div>
      <Table head={["Name", "Email"]} rows={bundle.people.map((person) => [person.name, person.email ?? "—"])} empty="No people yet." />
    </>
  );
}

function Invites({ bundle, tab }: { bundle: SheetBundle; tab?: string }) {
  const kind = tab === "clients" ? "portal" : "staff";
  const now = new Date().toISOString();
  const rows = bundle.invites.filter((row) => row.kind === kind);
  return (
    <>
      <div className="ph"><h1 className="display">{kind === "portal" ? "Portal invitations" : "Staff invitations"}</h1></div>
      <Table head={["Email", "Role", "State", "Expires"]} rows={rows.map((row) => [row.email, roleLabel(row.role), invitationLabel(row, now), row.expiresAt.slice(0, 10)])} empty="No invitations." />
    </>
  );
}

function Grants({ bundle }: { bundle: SheetBundle }) {
  return <Table head={["Kind", "Purpose", "Subject"]} rows={bundle.grants.map((row) => [row.kind, row.purpose, personName(bundle, row.subjectPersonId)])} empty="No active grants." />;
}

function Government({ bundle }: { bundle: SheetBundle }) {
  return (
    <>
      <div className="ph"><h1 className="display">Government status</h1><p>Statuses are recorded by the firm. Nothing here is a live IRCC feed.</p></div>
      <Table head={["Matter", "Status"]} rows={bundle.matters.map((matter) => [<Link key={matter.id} href={`/sheet/matters/${matter.id}`}>{matter.title}</Link>, governmentLabel(matter.governmentStatus)])} empty="No matters." />
    </>
  );
}

function Licences({ bundle }: { bundle: SheetBundle }) {
  const suspended = bundle.credentials.filter((row) => row.status === "suspended" || row.status === "revoked");
  return (
    <>
      <div className="ph"><h1 className="display">Licences</h1>{suspended.length ? <p>{suspended.length} credential(s) block practice actions.</p> : null}</div>
      <Table head={["College id", "Type", "Regulator", "Status"]} rows={bundle.credentials.map((row) => [row.collegeId, row.licenceType, row.regulator, row.status])} empty="No credentials declared." />
    </>
  );
}

function Settings({ bundle, tab, page, finance }: { bundle: SheetBundle; tab?: string; page: string; finance: FinanceSnapshot | null }) {
  const current = page === "sample-mode" ? "sample" : tab || "general";
  if (current === "sample") {
    return <div className="panel"><h2>Sample mode is off</h2><p>{bundle.staff.organizationName} is a live firm. The Northline walkthrough is not mixed into these records.</p></div>;
  }
  const unwired = slotFor("settings", current);
  if (unwired) return <Slot message={unwired} />;
  if (current === "team") {
    return (
      <>
        <Table head={["Role", "Status"]} rows={bundle.members.map((row) => [roleLabel(row.role), row.status])} empty="No members." />
        <Slot message={slotFor("settings", "offboarding") ?? ""} />
      </>
    );
  }
  if (current === "offices") {
    return <Table head={["Office", "Locality", "Region"]} rows={bundle.offices.map((row) => [row.label + (row.primary ? " · primary" : ""), row.locality, row.region ?? "—"])} empty="No offices saved." />;
  }
  if (current === "billing" && finance) {
    return <FinanceLive organizationId={bundle.staff.organizationId} snapshot={finance} showPlan />;
  }
  return (
    <div className="panel">
      <h2>{bundle.staff.organizationName}</h2>
      <p>Legal name {bundle.staff.legalName}. Timezone {bundle.staff.timezone}.</p>
    </div>
  );
}

function Roles() {
  return <Table head={["Role"]} rows={STAFF_ROLES.map((role) => [roleLabel(role)])} empty="" />;
}

function Templates({ bundle }: { bundle: SheetBundle }) {
  return (
    <>
      <Table head={["Template", "Kind", "Status"]} rows={bundle.templates.map((row) => [row.title, row.kind, row.status])} empty="No intake or agreement templates." />
      <Slot message="Message templates, checklists and the source-review register are not stored on this screen." />
    </>
  );
}

function Badge({ className, label }: { className: string; label: string }) {
  return <span className={className}><i></i>{label}</span>;
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number | ReactNode)[][]; empty: string }) {
  if (!rows.length) return <div className="panel"><div className="emp"><b>{empty}</b></div></div>;
  return (
    <div className="tw">
      <table className="t">
        <thead><tr>{head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
