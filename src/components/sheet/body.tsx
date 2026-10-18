import { notFound, redirect } from "next/navigation";
import { DemoSheet } from "@/components/sheet/demo";
import { CalendarHeader, CalendarRbarView, SheetCalendar } from "@/components/sheet/designer/calendar";
import { BookDialog, CancelDialog, ConsultationsHeader, RescheduleDialog, SheetConsultations } from "@/components/sheet/designer/consultations";
import { AvailabilityDialog, BookingTypeDialog } from "@/components/sheet/designer/scheduling-dialogs";
import { AgreementsHeader, CountersignDialog, NewAgreementDialog, SheetAgreements, TemplateDialog } from "@/components/sheet/designer/agreements";
import { ClientsHeader, DuplicateDialog, SheetClients } from "@/components/sheet/designer/clients";
import { CreditNoteDialog, FinanceHeader, NewInvoiceDialog, RefundDialog, SheetFinance, SheetFinancePayments, SheetFinanceRefunds } from "@/components/sheet/designer/finance";
import { CreditReviewDialog, SheetFinanceInvoice, VoidDialog } from "@/components/sheet/designer/invoice";
import { ReconDialogs, SheetFinanceRecon } from "@/components/sheet/designer/recon";
import { SheetFrame } from "@/components/sheet/designer/frame";
import { ApproveTransferDialog, FundsLiveDialogs, RecordPaymentDialog, SheetFinanceFunds, VerifyPaymentDialog } from "@/components/sheet/designer/funds";
import { StripeAccountStatus } from "@/components/sheet/stripe-connect";
import { SheetHome } from "@/components/sheet/designer/home";
import { GOVERNMENT_CSS, GovernmentHeader, SheetGovernment } from "@/components/sheet/designer/government";
import { GovDialogs } from "@/components/sheet/designer/matter-government";
import { loadSheetGovernment } from "@/modules/sheet/government-load";
import { MatterDialogs, MatterRbar, MatterTopBar, SheetMatter } from "@/components/sheet/designer/matter";
import { MATTER_CSS } from "@/components/sheet/designer/matter-css";
import { MattersTopBar, NewMatterDialog, SheetMatters } from "@/components/sheet/designer/matters";
import { PersonEditDialog } from "@/components/sheet/designer/person-edit";
import { SampleCasePanel } from "@/components/sheet/designer/sample-case";
import { SAMPLE_CASE_CSS } from "@/components/sheet/designer/sample-case-css";
import { SheetStaffTab, StaffAfter, StaffHeader } from "@/components/sheet/designer/invitations";
import { PolicyMissingAlert, PortalPoliciesAfter, SettingsPortalHeader, SheetPortalPolicies } from "@/components/sheet/designer/portal-policies";
import { SettingsHeader, SheetSettingsSecurity, SheetSettingsTeam } from "@/components/sheet/designer/settings";
import { loadSheetSettingsSecurity, loadSheetSettingsTeam } from "@/modules/sheet/settings-load";
import { SheetTasks, TasksDialog, TasksHeader } from "@/components/sheet/designer/tasks";
import { NotificationsHeader, SheetNotifications } from "@/components/sheet/designer/notifications";
import { loadSheetNotifications } from "@/modules/sheet/notifications-load";
import { LeadScreen, PipelineScreen } from "@/components/sheet/lead-screens";
import { ReportsExportDialog, ReportsHeader, SheetReports } from "@/components/sheet/designer/reports";
import { loadSheetReports } from "@/modules/sheet/reports-load";
import { QueueHeader, SheetQueue } from "@/components/sheet/designer/queue";
import { loadSheetQueue } from "@/modules/sheet/queue-load";
import { ExportsDialog, ExportsHeader, SheetExports } from "@/components/sheet/designer/exports";
import { loadSheetExports } from "@/modules/sheet/exports-load";
import { MigrationHeader, SheetMigration } from "@/components/sheet/designer/migration";
import { loadSheetMigration } from "@/modules/sheet/migration-load";
import { DocumentReviewDialog, DocumentsHeader, SheetDocuments } from "@/components/sheet/designer/documents";
import { ComposeDialog, InboxHeader, SheetInbox } from "@/components/sheet/designer/inbox";
import { PrivacyDialogs, PrivacyHeader, SheetPrivacy } from "@/components/sheet/designer/privacy";
import { ComplaintsDialogs, ComplaintsHeader, SheetComplaints } from "@/components/sheet/designer/complaints";
import { LiveSheet, QuietSheet } from "@/components/sheet/live";
import { ROLES_CSS, RolesHeader, SheetRoles } from "@/components/sheet/designer/roles";
import { LicenceAfter, LicenceHeader, SheetLicences } from "@/components/sheet/designer/licence";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import { loadSheetLicence } from "@/modules/sheet/licence-load";
import { ROLE_MATRIX } from "@/modules/staff/role-matrix";
import { SUSPENDED_CSS, SuspendedAlert, SuspendedPanel, SuspendedTopBar } from "@/components/sheet/designer/licence-suspended";
import { loadSheetLicenceSuspended } from "@/modules/sheet/licence-suspended-load";
import { SUSPENDED_REVEAL } from "@/modules/sheet/licence-suspended-present";
import { GrantDialog, GrantsHeader, SheetGrants } from "@/components/sheet/designer/grants";
import { loadSheetGrants } from "@/modules/sheet/grants-load";
import { INTAKE_BUILDER_CSS, IntakeHeader, IntakeSettings, SheetIntakeBuilder } from "@/components/sheet/designer/intake-builder";
import { loadSheetIntakeBuilder } from "@/modules/sheet/intake-builder-load";
import { SheetTemplates, TemplatesHeader } from "@/components/sheet/designer/templates";
import { loadSheetTemplates } from "@/modules/sheet/templates-load";
import { AutomationsHeader, AutomationsSettings, SheetAutomations } from "@/components/sheet/designer/automations";
import { loadSheetAutomations } from "@/modules/sheet/automations-load";
import { SheetScreen } from "@/components/sheet/screen";
import { AskVoDialog, DraftsHeader, DraftsRbar, SheetDrafts } from "@/components/sheet/designer/drafts";
import { AiHeader, SheetAi, type AiTab } from "@/components/sheet/designer/ai";
import { loadSheetAi, loadSheetDrafts } from "@/modules/sheet/vo-load";
import { SHEET_MARKUP, type SheetPage } from "@/components/sheet/markup/registry";
import { homeRoute } from "@/lib/auth/home-route";
import { isUuid } from "@/lib/tenant/context";
import { signInLocation } from "@/lib/auth/redirect";
import { loadSheetAgreements } from "@/modules/sheet/agreements-load";
import { todayIso } from "@/modules/sheet/birth-date";
import { loadSheetClients } from "@/modules/sheet/clients-load";
import { loadSheetFinance } from "@/modules/sheet/finance-load";
import { loadSheetHome } from "@/modules/sheet/home-load";
import { loadSheetPortalPolicies } from "@/modules/sheet/portal-policies-load";
import { loadSheetMatter } from "@/modules/sheet/matter-load";
import { loadSheetMatters } from "@/modules/sheet/matters-load";
import { loadSheetSample } from "@/modules/sheet/sample-load";
import { loadSheetStaffTab } from "@/modules/sheet/staff-load";
import { loadSheetTasks } from "@/modules/sheet/tasks-load";
import { loadSheetDocuments } from "@/modules/sheet/documents-load";
import { loadSheetInbox } from "@/modules/sheet/inbox-load";
import { loadSheetComplaints, loadSheetPrivacy } from "@/modules/sheet/compliance-load";
import { loadSheetAccess, loadSheetBundle } from "@/modules/sheet/load";
import type { SheetQuery } from "@/modules/sheet/present";
import { loadSheetCalendar, loadSheetConsultations } from "@/modules/scheduling/sheet-load";
import { loadSheetLead, loadSheetPipeline } from "@/modules/leads/load";

const PUBLIC = new Set(["enquiry", "book"]);

export function isSheetPage(page: string): page is SheetPage {
  return page in SHEET_MARKUP;
}

function sheetPath(page: string, matterId?: string) {
  if (page === "index") return "/sheet";
  if (page === "matters") return "/sheet/matters";
  if (page === "matter") return matterId ? `/sheet/matters/${matterId}` : "/sheet/matters";
  if (page === "enquiry") return "/enquiry";
  if (page === "book") return "/book";
  return `/sheet/${page}`;
}

export async function SheetBody({
  page,
  query,
  matterId,
}: {
  page: string;
  query: SheetQuery;
  matterId?: string;
}) {
  if (!isSheetPage(page)) notFound();
  const tone = PUBLIC.has(page) ? "public" : "sheet";
  const access = await loadSheetAccess();
  if (!PUBLIC.has(page) && access.kind === "signed-out") redirect(signInLocation(sheetPath(page, matterId)));
  if (!PUBLIC.has(page) && access.kind === "empty") {
    // Signed in without a firm: clients go to their portal, an unfinished sign-up to its firm step.
    const home = await homeRoute();
    if (home === "/portal" || home === "/start-trial") redirect(home);
  }
  // The Designer home with the firm's own records, in sample mode too. Sample records are real rows marked sample.
  // The licence-suspended home: the Sheet home for a consultant whose own licence check recorded an
  // adverse result (ORG-05). The home shows it too, so the consultant can't miss it.
  if ((page === "index" || page === "licence-suspended") && (access.kind === "live" || access.kind === "sample")) {
    const suspended = await loadSheetLicenceSuspended(access.staff);
    if (!suspended && page === "licence-suspended") redirect("/sheet/licence");
    if (suspended) {
      return (
        <SheetScreen page={page}>
          <SheetFrame sidebar={suspended.chrome.sidebar} header={<SuspendedTopBar data={suspended.top} />} rbar={suspended.rbar} styles={[SUSPENDED_CSS]} statusbar={suspended.chrome.statusbar}>
            <SheetHome
              data={suspended.home}
              before={<SuspendedAlert data={suspended.suspended} />}
              lead={<SuspendedPanel data={suspended.suspended} />}
              reveal={SUSPENDED_REVEAL}
            />
          </SheetFrame>
        </SheetScreen>
      );
    }
  }
  if (page === "index" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, rbar, home, missingPolicies } = await loadSheetHome(access.staff);
    // Until the firm publishes its portal terms and privacy notice, no invited client can join: say so here.
    const lead = missingPolicies.length ? <PolicyMissingAlert kinds={missingPolicies} style={{ marginBottom: "18px" }} /> : undefined;
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} top={chrome.top} rbar={rbar} statusbar={chrome.statusbar}>
          <SheetHome data={home} lead={lead} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  if (page === "sample-mode" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, rbar, home, sample } = await loadSheetSample(access.staff);
    return (
      <SheetScreen page={page}>
        <style dangerouslySetInnerHTML={{ __html: SAMPLE_CASE_CSS }} />
        <SheetFrame sidebar={chrome.sidebar} top={chrome.top} rbar={rbar} statusbar={chrome.statusbar}>
          <SheetHome data={home} lead={<SampleCasePanel data={sample} />} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  if (page === "matters" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, matters, newMatter } = await loadSheetMatters(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} header={<MattersTopBar counts={matters.counts} newMatter />} statusbar={chrome.statusbar}>
          <SheetMatters data={matters} />
          <NewMatterDialog data={newMatter} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  if (page === "tasks" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, tasks } = await loadSheetTasks(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<TasksHeader tab={tasks.tab} counts={tasks.counts} />}
          statusbar={chrome.statusbar}
          after={<TasksDialog data={tasks.dialog} />}
        >
          <SheetTasks data={tasks} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Documents: To review (with the review dialog), All documents and Originals we hold (DOC-01..06).
  if (page === "documents" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, documents, dialog } = await loadSheetDocuments(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<DocumentsHeader tab={documents.tab} pills={documents.pills} />}
          statusbar={chrome.statusbar}
          after={dialog ? <DocumentReviewDialog data={dialog} /> : undefined}
        >
          <SheetDocuments data={documents} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Inbox: Conversations (filed client email), Email to triage, Delivery problems and Announcements (OPS-06).
  if (page === "inbox" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, pills, inbox, compose } = await loadSheetInbox(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<InboxHeader tab={inbox.tab} pills={pills} />}
          statusbar={chrome.statusbar}
          after={<ComposeDialog data={compose} />}
        >
          <SheetInbox data={inbox} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Reports (T041): Operations, Money, Processing and outcomes, Scheduled. Each tab is role-gated.
  if (page === "reports" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, reports } = await loadSheetReports(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<ReportsHeader tab={reports.tab} pills={reports.pills} />}
          statusbar={chrome.statusbar}
          after={<ReportsExportDialog data={reports.dialog} />}
        >
          <SheetReports data={reports} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Compliance > Privacy requests (SEC-05, SEC-06) and Complaints (ADM-05).
  if (page === "privacy" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetPrivacy(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<PrivacyHeader data={loaded.header} />}
          statusbar={loaded.chrome.statusbar}
          after={<PrivacyDialogs data={loaded.dialogs} />}
        >
          <SheetPrivacy data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Team queue: open tasks, reviews, deadlines to verify and money waiting for a second person.
  if (page === "queue" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, queue } = await loadSheetQueue(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} header={<QueueHeader counts={queue.counts} />} statusbar={chrome.statusbar}>
          <SheetQueue data={queue} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Client-file exports (T040): export jobs for the matters the signed-in person can export.
  if (page === "exports" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, exports } = await loadSheetExports(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<ExportsHeader data={exports.header} />}
          statusbar={chrome.statusbar}
          after={<ExportsDialog data={exports.dialog} />}
        >
          <SheetExports data={exports} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Compliance > Migration import (T044, PRD §25): the firm owner's CSV import with dry run and rollback.
  if (page === "migration" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetMigration(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<MigrationHeader data={loaded.header} />} statusbar={loaded.chrome.statusbar}>
          <SheetMigration data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  if (page === "complaints" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetComplaints(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<ComplaintsHeader data={loaded.header} />}
          statusbar={loaded.chrome.statusbar}
          after={<ComplaintsDialogs data={loaded.dialogs} />}
        >
          <SheetComplaints data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // People and invitations, Clients and family tab: not ported, so a real firm goes to the Clients
  // page, where client and family records live and portal invitations are sent from the matter.
  if (page === "invitations" && query.tab === "clients" && (access.kind === "live" || access.kind === "sample")) {
    redirect("/sheet/clients");
  }
  // People and invitations, Staff tab.
  if (page === "invitations" && query.tab !== "clients" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, page: staff, dialog } = await loadSheetStaffTab(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<StaffHeader firmName={staff.firmName} />}
          statusbar={chrome.statusbar}
          after={<StaffAfter dialog={dialog} />}
        >
          <SheetStaffTab data={staff} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Client portal: the firm's portal terms and privacy notice. The other Settings tabs keep their old view.
  if (page === "settings" && query.tab === "portal" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, page: policies, dialogs } = await loadSheetPortalPolicies(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<SettingsPortalHeader firmName={policies.firmName} />}
          statusbar={chrome.statusbar}
          after={<PortalPoliciesAfter dialogs={dialogs} />}
        >
          <SheetPortalPolicies data={policies} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Team and seats and Security: the firm's team, invitations, continuity contact and sign-in posture.
  if (page === "settings" && (query.tab === "team" || query.tab === "security") && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, header, content } =
      query.tab === "team"
        ? await loadSheetSettingsTeam(access.staff).then((loaded) => ({ ...loaded, content: <SheetSettingsTeam data={loaded.page} /> }))
        : await loadSheetSettingsSecurity(access.staff).then((loaded) => ({ ...loaded, content: <SheetSettingsSecurity data={loaded.page} /> }));
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} header={<SettingsHeader data={header} />} statusbar={chrome.statusbar}>
          {content}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Roles and permissions: what each role may do, as the server enforces it.
  if (page === "roles" && (access.kind === "live" || access.kind === "sample")) {
    const chrome = await loadSheetChrome(access.staff, "/sheet/roles");
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} header={<RolesHeader pills={ROLE_MATRIX.pills} />} styles={[ROLES_CSS]} statusbar={chrome.statusbar}>
          <SheetRoles data={ROLE_MATRIX} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Licences: each consultant's CICC licence and the manual register checks (Licences and Review log tabs).
  if (page === "licence" && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "log" ? "log" : "lic";
    const loaded = await loadSheetLicence(access.staff, tab);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<LicenceHeader firmName={loaded.page.firmName} tab={tab} />}
          statusbar={loaded.chrome.statusbar}
          after={<LicenceAfter dialogs={loaded.dialogs} />}
        >
          <SheetLicences data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Practice > Access grants: person and matter grants, Support access and Office and team limits.
  if (page === "grants" && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "support" || query.tab === "limits" ? query.tab : "grants";
    const loaded = await loadSheetGrants(access.staff, tab);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<GrantsHeader tab={tab} pills={loaded.page.pills} />}
          statusbar={loaded.chrome.statusbar}
          after={<GrantDialog data={loaded.dialog} />}
        >
          <SheetGrants data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Automations: the deadline-reminder rule as it runs, and its reminder history (read only).
  if (page === "automations" && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "runs" ? "runs" : "builder";
    const loaded = await loadSheetAutomations(access.staff, tab);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<AutomationsHeader data={loaded.data} />}
          aside={<AutomationsSettings data={loaded.data} />}
          statusbar={loaded.chrome.statusbar}
        >
          <SheetAutomations data={loaded.data} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Vo drafts: AI drafts waiting for a person (AI-03), and Ask Vo. Vo drafts only; people send.
  if (page === "drafts" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetDrafts(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<DraftsHeader data={loaded.header} />}
          aside={<DraftsRbar data={loaded.data} />}
          statusbar={loaded.chrome.statusbar}
          after={loaded.ask ? <AskVoDialog data={loaded.ask} /> : undefined}
        >
          <SheetDrafts data={loaded.data} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Practice > Vo and AI: settings, run log, citations library, abstain and offline, human approval, draft audit.
  if (page === "settings" && query.tab === "ai" && (access.kind === "live" || access.kind === "sample")) {
    redirect("/sheet/ai");
  }
  if (page === "ai" && (access.kind === "live" || access.kind === "sample")) {
    const tab: AiTab = query.tab === "runs" || query.tab === "sources" || query.tab === "states" || query.tab === "rules" || query.tab === "audit" ? query.tab : "settings";
    const loaded = await loadSheetAi(access.staff, tab);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<AiHeader data={loaded.data} />} statusbar={loaded.chrome.statusbar}>
          <SheetAi data={loaded.data} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Practice > Templates: program and agreement templates, the approved email catalog, checklists, and the rule source register (read only).
  if (page === "templates" && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "messages" || query.tab === "checklists" || query.tab === "sources" || query.tab === "rule" ? query.tab : "program";
    const loaded = await loadSheetTemplates(access.staff, tab, query.view);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<TemplatesHeader data={loaded.data} />} statusbar={loaded.chrome.statusbar}>
          <SheetTemplates data={loaded.data} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Practice > Intake forms: the versioned form builder (Build and Preview tabs).
  if (page === "intake-builder" && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "preview" ? "preview" : "build";
    const loaded = await loadSheetIntakeBuilder(access.staff, tab, { form: query.form, field: query.field });
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<IntakeHeader data={loaded.data} />}
          aside={<IntakeSettings data={loaded.data} />}
          styles={[INTAKE_BUILDER_CSS]}
          statusbar={loaded.chrome.statusbar}
        >
          <SheetIntakeBuilder data={loaded.data} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  if (page === "clients" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, clients, newMatter } = await loadSheetClients(access.staff, query);
    const duplicate = clients.dir?.duplicate;
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<ClientsHeader data={clients} />}
          statusbar={chrome.statusbar}
          after={
            <>
              {duplicate ? <DuplicateDialog data={duplicate} /> : null}
              {/* "Add a client" opens New matter here: a client is recorded with the matter that lets the team read them. */}
              <NewMatterDialog data={newMatter} />
              {clients.edit ? <PersonEditDialog data={{ maxBirthDate: todayIso() }} /> : null}
            </>
          }
        >
          <SheetClients data={clients} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Agreements, All agreements tab. The other tabs (quote builder, editor, envelope, compare,
  // representation authority) are not ported yet and keep their old view.
  if (page === "agreements" && (!query.tab || query.tab === "list") && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, header, page: agreements, dialog, templateDialog, countersign } = await loadSheetAgreements(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<AgreementsHeader data={header} />}
          statusbar={chrome.statusbar}
          after={
            <>
              <NewAgreementDialog data={dialog} />
              <TemplateDialog data={templateDialog} />
              {countersign.map((sign) => (
                <CountersignDialog key={sign.envelopeId} data={sign} />
              ))}
            </>
          }
        >
          <SheetAgreements data={agreements} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Finance: Invoices, Payments, Client funds, Reconciliation, Refunds and disputes, and one
  // invoice's own tab (`?tab=invoice&view=<invoice id>`).
  if (
    page === "finance" &&
    (!query.tab || ["invoices", "payments", "funds", "recon", "refunds", "invoice"].includes(query.tab)) &&
    (access.kind === "live" || access.kind === "sample")
  ) {
    const invoiceId = query.tab === "invoice" && query.view && isUuid(query.view) ? query.view : null;
    const tab =
      query.tab === "payments" || query.tab === "funds" || query.tab === "refunds" || query.tab === "recon" ? query.tab : invoiceId ? "invoice" : "invoices";
    const finance = await loadSheetFinance(access.staff, tab, invoiceId);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={finance.chrome.sidebar}
          header={<FinanceHeader data={finance.header} />}
          statusbar={finance.chrome.statusbar}
          after={
            <>
              {finance.funds ? (
                <>
                  <RecordPaymentDialog data={finance.funds.pay} />
                  <VerifyPaymentDialog data={finance.funds.verify} />
                  <ApproveTransferDialog data={finance.funds.transfer} />
                </>
              ) : null}
              <NewInvoiceDialog data={finance.dialog} />
              {finance.refundDialog ? <RefundDialog data={finance.refundDialog} /> : null}
              {finance.funds ? <FundsLiveDialogs data={finance.funds.more} /> : null}
              {finance.invoiceView ? (
                <>
                  <CreditNoteDialog data={finance.invoiceView.creditDialog} />
                  {finance.invoiceView.reviewDialog ? <CreditReviewDialog data={finance.invoiceView.reviewDialog} /> : null}
                  {finance.invoiceView.voidDialog ? <VoidDialog data={finance.invoiceView.voidDialog} /> : null}
                </>
              ) : null}
              {finance.recon ? <ReconDialogs data={finance.recon.dialogs} /> : null}
            </>
          }
        >
          {finance.invoiceView ? (
            <SheetFinanceInvoice data={finance.invoiceView.view} />
          ) : finance.recon ? (
            <SheetFinanceRecon data={finance.recon.data} />
          ) : finance.funds ? (
            <SheetFinanceFunds data={finance.funds.data} />
          ) : finance.payments ? (
            <SheetFinancePayments data={finance.payments} status={<StripeAccountStatus data={finance.account} />} />
          ) : finance.refunds ? (
            <SheetFinanceRefunds data={finance.refunds} />
          ) : (
            <SheetFinance data={finance.page} />
          )}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Consultations: Upcoming, Availability and Booking page tabs (BUILD-SPEC §4). The Consultation
  // record tab (notes and outcome summaries) is not built and keeps its old view.
  if (page === "consultations" && query.tab !== "record" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetConsultations(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<ConsultationsHeader tab={loaded.tab} pills={loaded.pills} book={loaded.book} />}
          statusbar={loaded.chrome.statusbar}
          after={
            <>
              <BookDialog data={loaded.dialogs.book} />
              <RescheduleDialog data={loaded.dialogs.reschedule} />
              <CancelDialog data={loaded.dialogs.cancel} />
              <AvailabilityDialog organizationId={loaded.settings.organizationId} zones={loaded.settings.zones} />
              {loaded.settings.owner ? <BookingTypeDialog organizationId={loaded.settings.organizationId} hosts={loaded.settings.hosts} practice={loaded.settings.practice} /> : null}
            </>
          }
        >
          <SheetConsultations data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Calendar: the week of appointments and deadlines, and the Deadlines tab.
  if (page === "calendar" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetCalendar(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<CalendarHeader tab={loaded.tab} pills={loaded.pills} create={{ "data-nav": "/sheet/consultations?dlg=book" }} />}
          aside={<CalendarRbarView data={loaded.rbar} />}
          statusbar={loaded.chrome.statusbar}
        >
          <SheetCalendar data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Notifications: the signed-in staff member's in-app notifications (T034), Designer-exact.
  if (page === "notifications" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetNotifications(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<NotificationsHeader data={loaded.data} />} statusbar={loaded.chrome.statusbar}>
          <SheetNotifications data={loaded.data} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Government status: one matter's record (`?view=<matter id>`) or the firm's matters on record (T036, T037).
  if (page === "government" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetGovernment(access.staff, query);
    if (!loaded) notFound();
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<GovernmentHeader data={loaded.header} />} styles={GOVERNMENT_CSS} statusbar={loaded.chrome.statusbar}>
          <SheetGovernment data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Leads: the pipeline (Board, List, Timeline) and one lead (`/sheet/lead?id=`).
  if (page === "pipeline" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetPipeline(access.staff, query);
    return (
      <SheetScreen page={page}>
        <PipelineScreen loaded={loaded} />
      </SheetScreen>
    );
  }
  if (page === "lead" && (access.kind === "live" || access.kind === "sample")) {
    // The Designer's + Lead goes to /sheet/lead?new=1: New lead is a dialog on the pipeline.
    if (!query.id) redirect("/sheet/pipeline?new=1");
    const loaded = await loadSheetLead(access.staff, query.id, { conflict: query.dlg === "conflict" });
    if (!loaded) notFound();
    return (
      <SheetScreen page={page}>
        <LeadScreen loaded={loaded} />
      </SheetScreen>
    );
  }
  if (page === "matter" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = matterId ? await loadSheetMatter(access.staff, matterId, query) : null;
    if (!loaded) notFound();
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<MatterTopBar data={loaded.header} />}
          aside={<MatterRbar data={loaded.rbar} />}
          styles={MATTER_CSS}
          after={
            <>
              <MatterDialogs data={loaded.dialogs} />
              <GovDialogs data={loaded.governmentDialogs} />
              {loaded.countersign.map((sign) => (
                <CountersignDialog key={sign.envelopeId} data={sign} />
              ))}
            </>
          }
          statusbar={loaded.chrome.statusbar}
        >
          <SheetMatter data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  if (access.kind === "sample") {
    return (
      <SheetScreen page={page} tone={tone}>
        <DemoSheet page={page} query={query} />
      </SheetScreen>
    );
  }
  if (access.kind === "live" && !PUBLIC.has(page)) {
    const bundle = await loadSheetBundle(access.staff);
    return (
      <SheetScreen page={page}>
        <LiveSheet bundle={bundle} page={page} tab={query.tab} view={query.view} query={query.q} matterId={matterId} />
      </SheetScreen>
    );
  }
  return (
    <SheetScreen page={page} tone={tone}>
      <QuietSheet
        title={PUBLIC.has(page) ? "This form isn’t available" : "No workspace yet"}
        copy={PUBLIC.has(page) ? "A published form appears here when your firm turns one on." : "This account isn’t a member of a firm workspace."}
      />
    </SheetScreen>
  );
}

export function queryFrom(search: Record<string, string | string[] | undefined>): SheetQuery {
  const one = (key: keyof SheetQuery) => {
    const value = search[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    tab: one("tab"),
    view: one("view"),
    outcome: one("outcome"),
    hold: one("hold"),
    ready: one("ready"),
    dlg: one("dlg"),
    q: one("q"),
    state: one("state"),
    limit: one("limit"),
    person: one("person"),
    week: one("week"),
    thread: one("thread"),
    form: one("form"),
    field: one("field"),
    id: one("id"),
    stage: one("stage"),
    owner: one("owner"),
  };
}
