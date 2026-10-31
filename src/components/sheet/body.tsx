import { GoLivePanel, TestModeDialog } from "@/components/sheet/designer/go-live-panel";
import { loadGoLivePanel } from "@/modules/sheet/go-live-load";
import { notFound, redirect } from "next/navigation";
import { DemoSheet } from "@/components/sheet/demo";
import { CalendarHeader, CalendarRbarView, SheetCalendar } from "@/components/sheet/designer/calendar";
import { BookDialog, CancelDialog, ConsultationsHeader, RescheduleDialog, SheetConsultationRecord, SheetConsultations, SummaryDialog } from "@/components/sheet/designer/consultations";
import { AvailabilityDialog, BookingTypeDialog } from "@/components/sheet/designer/scheduling-dialogs";
import { AgreementsHeader, CountersignDialog, NewAgreementDialog, SheetAgreements, TemplateDialog } from "@/components/sheet/designer/agreements";
import {
  AuthorityDialog,
  SheetAgreementEnvelope,
  SheetAgreementsAuthority,
  SheetAgreementsPending,
  VoidEnvelopeDialog,
} from "@/components/sheet/designer/agreements-live";
import { NewQuoteDialog, QuoteConvertDialog, QuoteEditDialog, QuotePreviewDialog, SheetAgreementQuote, SheetAgreementsPick } from "@/components/sheet/designer/agreements-quote";
import { ClauseDialog, SheetAgreementEditor } from "@/components/sheet/designer/agreements-editor";
import { SheetAgreementCompare } from "@/components/sheet/designer/agreements-compare";
import { ClientsHeader, DuplicateDialog, SheetClients } from "@/components/sheet/designer/clients";
import { CreditDialog, CreditNoteDialog, EvidenceDialog, FinanceHeader, NewInvoiceDialog, RefundDialog, SheetFinance, SheetFinancePayments, SheetFinanceRefunds } from "@/components/sheet/designer/finance";
import { OpeningBalancesPanel } from "@/components/sheet/opening-balances";
import { CreditReviewDialog, SheetFinanceInvoice, VoidDialog } from "@/components/sheet/designer/invoice";
import { ReconDialogs, SheetFinanceRecon } from "@/components/sheet/designer/recon";
import { FinanceBillingDialogs, FinanceBillingPanels, InvoiceBillingDialogs, MatterWorkDialogs } from "@/components/sheet/designer/billing-live";
import { SheetFrame } from "@/components/sheet/designer/frame";
import { ApproveTransferDialog, FundsLiveDialogs, RecordPaymentDialog, SheetFinanceFunds, VerifyPaymentDialog } from "@/components/sheet/designer/funds";
import { StripeAccountStatus, StripeConnectCard } from "@/components/sheet/stripe-connect";
import { SheetHome } from "@/components/sheet/designer/home";
import { GOVERNMENT_CSS, GovernmentHeader, SheetGovernment } from "@/components/sheet/designer/government";
import { GovDialogs } from "@/components/sheet/designer/matter-government";
import { loadSheetGovernment } from "@/modules/sheet/government-load";
import { MatterDialogs, MatterRbar, MatterTopBar, SheetMatter } from "@/components/sheet/designer/matter";
import { MatterLetterDialogs } from "@/components/sheet/designer/matter-letters";
import { MATTER_CSS } from "@/components/sheet/designer/matter-css";
import { MattersTopBar, NewMatterDialog, SheetMatters } from "@/components/sheet/designer/matters";
import { PersonEditDialog } from "@/components/sheet/designer/person-edit";
import { SampleCasePanel } from "@/components/sheet/designer/sample-case";
import { SAMPLE_CASE_CSS } from "@/components/sheet/designer/sample-case-css";
import { INVITATIONS_CSS, SheetClientsTab, SheetStaffTab, StaffAfter, StaffHeader } from "@/components/sheet/designer/invitations";
import { PolicyMissingAlert, PortalPoliciesAfter, PublicPagesAlert, SettingsPortalHeader, SheetPortalPolicies } from "@/components/sheet/designer/portal-policies";
import { SettingsFirmAfter, SettingsFirmHeader, SheetSettingsBranding, SheetSettingsFirm, SheetSettingsLanguage, SheetSettingsOffices } from "@/components/sheet/designer/settings-firm";
import { loadSheetSettingsFirm } from "@/modules/sheet/settings-firm-load";
import { settingsTab } from "@/modules/sheet/settings-firm-present";
import { SettingsHeader, SheetSettingsSecurity, SheetSettingsTeam } from "@/components/sheet/designer/settings";
import { TeamDialogs } from "@/components/sheet/designer/settings-staff-admin";
import { FirmTransferDialogs, FirmTransfersPanel } from "@/components/sheet/designer/firm-transfers";
import { PlanDialog, SettingsBillingHeader, SheetRetention, SheetSubscription } from "@/components/sheet/designer/settings-billing";
import { BankAccountDialogs, ManualPaymentDialogs, ReconItemDialog, SettingsBankAccounts } from "@/components/sheet/designer/manual-pay";
import { loadSheetRetention, loadSheetSubscription } from "@/modules/sheet/settings-billing-load";
import { DeletionDialog, RetentionDeletionPanels } from "@/components/sheet/designer/sec-retention";
import { CancelSubscriptionDialog, ContinuityPanel, EndArrangementDialog } from "@/components/sheet/designer/sec-continuity";
import { loadRetentionDeletion } from "@/modules/sheet/sec-load";
import { loadSheetSettingsSecurity, loadSheetSettingsTeam } from "@/modules/sheet/settings-load";
import { SheetServiceNotices } from "@/components/sheet/designer/service-notices";
import { loadServiceNoticeHistory } from "@/modules/sheet/service-notices-load";
import { SheetTasks, TaskEditDialog, TasksDialog, TasksHeader } from "@/components/sheet/designer/tasks";
import { ComposioDialog, IntegrationsSettingsHeader, SheetIntegrations, SheetNotificationPrefs, WhatsAppDialog } from "@/components/sheet/designer/settings-integrations";
import { loadSheetSettingsIntegrations } from "@/modules/sheet/settings-integrations-load";
import { NotificationsHeader, SheetNotifications } from "@/components/sheet/designer/notifications";
import { loadSheetNotifications } from "@/modules/sheet/notifications-load";
import { LeadScreen, PipelineScreen } from "@/components/sheet/lead-screens";
import { ReportsExportDialog, ReportsHeader, SheetReports } from "@/components/sheet/designer/reports";
import { ScheduleReportDialog } from "@/components/sheet/designer/scheduled-reports";
import { loadSheetReports } from "@/modules/sheet/reports-load";
import { QueueHeader, SheetQueue } from "@/components/sheet/designer/queue";
import { loadSheetQueue } from "@/modules/sheet/queue-load";
import { ExportsDialog, ExportsHeader, SheetExports } from "@/components/sheet/designer/exports";
import { loadSheetExports } from "@/modules/sheet/exports-load";
import { MigrationHeader, SheetMigration } from "@/components/sheet/designer/migration";
import { loadSheetMigration } from "@/modules/sheet/migration-load";
import { DocumentReviewDialog, DocumentsHeader, SheetDocuments } from "@/components/sheet/designer/documents";
import { AnnouncementDialog, ComposeDialog, InboxHeader, SheetInbox } from "@/components/sheet/designer/inbox";
import { FileToMatterDialog } from "@/components/sheet/designer/inbound-filing";
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
import { GrantDialog, GrantRevokeDialog, GrantsHeader, SheetGrants, SupportDeclineDialog } from "@/components/sheet/designer/grants";
import { loadSheetGrants } from "@/modules/sheet/grants-load";
import { INTAKE_BUILDER_CSS, IntakeHeader, IntakeSettings, SheetIntakeBuilder } from "@/components/sheet/designer/intake-builder";
import { loadSheetIntakeBuilder } from "@/modules/sheet/intake-builder-load";
import { MessageTemplateDialog, SheetTemplates, TemplatesHeader } from "@/components/sheet/designer/templates";
import { AddClaimDialog, ClaimReviewDialogs } from "@/components/sheet/designer/source-claims";
import { OfficialClaimDialogs } from "@/components/sheet/designer/official-claims";
import { OpenOnLoad } from "@/components/sheet/open-on-load";
import { loadSheetTemplates } from "@/modules/sheet/templates-load";
import { loadSheetSupportCatalogue } from "@/modules/sheet/support-catalogue-load";
import { SheetSupportCatalogue } from "@/components/sheet/designer/support-catalogue";
import { AutomationsDialog, AutomationsHeader, AutomationsSettings, SheetAutomations } from "@/components/sheet/designer/automations";
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
import { loadSheetClientsTab, loadSheetStaffTab } from "@/modules/sheet/staff-load";
import { loadSheetTasks } from "@/modules/sheet/tasks-load";
import { loadSheetDocuments } from "@/modules/sheet/documents-load";
import { loadSheetInbox } from "@/modules/sheet/inbox-load";
import { loadSheetComplaints, loadSheetPrivacy } from "@/modules/sheet/compliance-load";
import { loadSheetAccess, loadSheetBundle } from "@/modules/sheet/load";
import type { SheetQuery } from "@/modules/sheet/present";
import { loadSheetCalendar, loadSheetConsultations } from "@/modules/scheduling/sheet-load";
import { loadSheetLead, loadSheetPipeline } from "@/modules/leads/load";
import { EnquiryShareDialog } from "@/components/sheet/designer/enquiry-share";
import { loadEnquiryShare } from "@/modules/leads/share-load";
import { loadLeadVo } from "@/modules/sheet/vo-crm-load";
import { NoAccessPanel, StateAlert, StateAlerts } from "@/components/sheet/designer/state-views";
import { financeAccess, grantsAccess, migrationAccess, recordNotOpen, subscriptionAccess, type NoAccessData } from "@/modules/sheet/states-present";
import { loadSourceStaleness } from "@/modules/sheet/states-load";
import type { SheetStaff } from "@/modules/sheet/load";

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
  // The Designer's gallery of example states (fictional data) is a design reference, not a firm page.
  if (page === "states") notFound();
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
    const suspended = await loadSheetLicenceSuspended(access.staff, undefined, { month: query.month, path: sheetPath(page) });
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
    const { chrome, rbar, home, missingPolicies, publicPages } = await loadSheetHome(access.staff, undefined, { month: query.month });
    // Until the firm publishes its portal terms and privacy notice, no invited client can join: say so here.
    // #263-A: and when its booking or enquiry pages are on without a privacy notice.
    const lead =
      missingPolicies.length || publicPages ? (
        <>
          {publicPages ? <PublicPagesAlert warning={publicPages} link style={{ marginBottom: "18px" }} /> : null}
          {missingPolicies.length ? <PolicyMissingAlert kinds={missingPolicies} style={{ marginBottom: "18px" }} /> : null}
        </>
      ) : undefined;
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} top={chrome.top} rbar={rbar} statusbar={chrome.statusbar}>
          <SheetHome data={home} lead={lead} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  if (page === "sample-mode" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, rbar, home, sample } = await loadSheetSample(access.staff, undefined, { month: query.month, path: "/sheet/sample-mode" });
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
          header={<TasksHeader tab={tasks.tab} counts={tasks.counts} canCreate={tasks.canCreate !== false} escalate={tasks.escalate} />}
          statusbar={chrome.statusbar}
          after={
            <>
              <TasksDialog data={tasks.dialog} />
              {tasks.edit ? <TaskEditDialog data={tasks.edit} /> : null}
            </>
          }
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
    const { chrome, pills, inbox, compose, announce } = await loadSheetInbox(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<InboxHeader tab={inbox.tab} pills={pills} announce={Boolean(announce)} />}
          statusbar={chrome.statusbar}
          after={
            <>
              <ComposeDialog data={compose} />
              {announce ? <AnnouncementDialog data={announce} /> : null}
              {inbox.tab === "triage" ? <FileToMatterDialog organizationId={access.staff.organizationId} /> : null}
            </>
          }
        >
          <SheetInbox data={inbox} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Reports (T041): Operations, Money, Processing and outcomes, Scheduled. Each tab is role-gated.
  if (page === "reports" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, reports, scheduleDialog } = await loadSheetReports(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<ReportsHeader tab={reports.tab} pills={reports.pills} pillTitles={reports.pillTitles} />}
          statusbar={chrome.statusbar}
          after={
            <>
              <ReportsExportDialog data={reports.dialog} />
              {scheduleDialog ? <ScheduleReportDialog data={scheduleDialog} /> : null}
            </>
          }
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
    const { chrome, queue, partial } = await loadSheetQueue(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} header={<QueueHeader counts={queue.counts} filter={{ "data-queue-filter": "1", "aria-controls": "ql", title: "Search and filter the queue" }} />} statusbar={chrome.statusbar}>
          {partial && !queue.failed ? <StateAlert data={partial} /> : null}
          <SheetQueue data={queue} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Client-file exports (T040): export jobs for the matters the signed-in person can export.
  if (page === "exports" && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, exports, partial } = await loadSheetExports(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<ExportsHeader data={exports.header} />}
          statusbar={chrome.statusbar}
          after={<ExportsDialog data={exports.dialog} />}
        >
          {partial ? <StateAlert data={partial} /> : null}
          <SheetExports data={exports} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Compliance > Migration import (T044, PRD §25): the firm owner's CSV import with dry run and rollback.
  if (page === "migration" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetMigration(access.staff, query);
    const denied = migrationAccess(access.staff.role);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<MigrationHeader data={loaded.header} />} statusbar={loaded.chrome.statusbar}>
          {denied ? <NoAccessPanel data={denied} /> : <SheetMigration data={loaded.page} />}
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
  // People and invitations, Clients and family tab: the firm's client portal invitations with their
  // state and revoke. New ones are sent from a matter's people, so Invite to portal goes to Matters.
  if (page === "invitations" && query.tab === "clients" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetClientsTab(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<StaffHeader firmName={loaded.firmName} tab={"clients"} inviteGo={"/sheet/matters"} />}
          statusbar={loaded.chrome.statusbar}
          after={<style dangerouslySetInnerHTML={{ __html: INVITATIONS_CSS }} />}
        >
          <SheetClientsTab rows={loaded.rows} />
        </SheetFrame>
      </SheetScreen>
    );
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
    const { chrome, page: policies, dialogs, unpublishOrg } = await loadSheetPortalPolicies(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<SettingsPortalHeader firmName={policies.firmName} />}
          statusbar={chrome.statusbar}
          after={<PortalPoliciesAfter dialogs={dialogs} unpublishOrg={unpublishOrg} />}
        >
          <SheetPortalPolicies data={policies} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Integrations and Notifications: real connection state and this person's email choices.
  if (page === "settings" && (query.tab === "integrations" || query.tab === "notifications") && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetSettingsIntegrations(access.staff, query.tab);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<IntegrationsSettingsHeader tab={loaded.tab} pills={loaded.pills} />}
          statusbar={loaded.chrome.statusbar}
          after={
            loaded.dialog || loaded.waDialog ? (
              <>
                {loaded.dialog ? <ComposioDialog data={loaded.dialog} /> : null}
                {loaded.waDialog ? <WhatsAppDialog data={loaded.waDialog} /> : null}
              </>
            ) : undefined
          }
        >
          {loaded.integrations ? <SheetIntegrations data={loaded.integrations} /> : null}
          {loaded.notifications ? <SheetNotificationPrefs data={loaded.notifications} /> : null}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Service notices (ADM-04): Casevoya's notices to this firm, current and past (reached from Security and the banner).
  if (page === "settings" && query.tab === "notices" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadServiceNoticeHistory(access.staff);
    return (
      <SheetScreen key={"settings-notices"} page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<SettingsHeader data={loaded.header} />} statusbar={loaded.chrome.statusbar}>
          <SheetServiceNotices data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Firm (the default tab), Offices, Branding, Language and time: the firm's own values.
  const firmTab = page === "settings" ? settingsTab(query.tab) : null;
  if (firmTab && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetSettingsFirm(access.staff, firmTab);
    const view = loaded.page;
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<SettingsFirmHeader data={loaded.header} />} statusbar={loaded.chrome.statusbar} after={<SettingsFirmAfter data={loaded.dialogs} />}>
          {view.tab === "general" ? <SheetSettingsFirm data={view.data} /> : null}
          {view.tab === "offices" ? <SheetSettingsOffices data={view.data} /> : null}
          {view.tab === "branding" ? <SheetSettingsBranding data={view.data} /> : null}
          {view.tab === "language" ? <SheetSettingsLanguage data={view.data} /> : null}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Team and seats and Security: the firm's team, invitations, continuity contact and sign-in posture.
  if (page === "settings" && (query.tab === "team" || query.tab === "security") && (access.kind === "live" || access.kind === "sample")) {
    const { chrome, header, content, after } =
      query.tab === "team"
        ? await loadSheetSettingsTeam(access.staff).then((loaded) => ({
            ...loaded,
            content: (
              <>
                <SheetSettingsTeam data={loaded.page} />
                {loaded.transfers ? <FirmTransfersPanel data={loaded.transfers} /> : null}
              </>
            ),
            after: (
              <>
                {loaded.dialogs ? <TeamDialogs {...loaded.dialogs} /> : null}
                {loaded.transfers ? <FirmTransferDialogs data={loaded.transfers} /> : null}
              </>
            ),
          }))
        : await loadSheetSettingsSecurity(access.staff).then((loaded) => ({ ...loaded, content: <SheetSettingsSecurity data={loaded.page} />, after: null }));
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} header={<SettingsHeader data={header} />} statusbar={chrome.statusbar} after={after}>
          {content}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Subscription (ADM-02): the firm's stored subscription state and real usage counts.
  // Keyed per tab so the Sheet's scripts mount again when the tab changes.
  if (page === "settings" && query.tab === "billing" && (access.kind === "live" || access.kind === "sample")) {
    // DES-04: the plan, usage, payment setup and bank accounts are for the firm owner and finance staff.
    const denied = subscriptionAccess(access.staff.role);
    if (denied) {
      const chrome = await loadSheetChrome(access.staff, "/sheet/settings");
      return (
        <SheetScreen key={"settings-billing"} page={page}>
          <SheetFrame sidebar={chrome.sidebar} header={<SettingsBillingHeader firmName={access.staff.organizationName} pill={"Firm owner and finance only"} tab={"billing"} />} statusbar={chrome.statusbar}>
            <NoAccessPanel data={denied} />
          </SheetFrame>
        </SheetScreen>
      );
    }
    const [loaded, goLive] = await Promise.all([loadSheetSubscription(access.staff), loadGoLivePanel(access.staff)]);
    return (
      <SheetScreen key={"settings-billing"} page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<SettingsBillingHeader firmName={access.staff.organizationName} pill={loaded.pill} tab={"billing"} />}
          // The Go live panel below says what the Test mode banner would.
          statusbar={goLive ? { ...loaded.chrome.statusbar, goLive: null } : loaded.chrome.statusbar}
          after={
            <>
              {loaded.page.dialog ? <PlanDialog data={loaded.page.dialog} /> : null}
              {loaded.accounts?.canAdd ? <BankAccountDialogs organizationId={loaded.accounts.organizationId} /> : null}
              {loaded.continuity.cancel ? <CancelSubscriptionDialog data={loaded.continuity.cancel} /> : null}
              {loaded.continuity.panel?.dialog ? <EndArrangementDialog data={loaded.continuity.panel.dialog} /> : null}
              {goLive?.live && goLive.owner ? <TestModeDialog /> : null}
            </>
          }
        >
          {goLive ? <GoLivePanel data={goLive} index={0} /> : null}
          <SheetSubscription data={loaded.page}>
            {loaded.continuity.panel ? <ContinuityPanel data={loaded.continuity.panel} index={2} /> : null}
            <StripeConnectCard data={loaded.connect.data} card={loaded.connect.card} index={3} />
          </SheetSubscription>
          {loaded.accounts ? <SettingsBankAccounts data={loaded.accounts} index={4} /> : null}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Settings > Retention (SEC-07): the firm's own retention period, its version and legal holds.
  if (page === "settings" && query.tab === "retention" && (access.kind === "live" || access.kind === "sample")) {
    const [loaded, deletion] = await Promise.all([loadSheetRetention(access.staff), loadRetentionDeletion(access.staff)]);
    return (
      <SheetScreen key={"settings-retention"} page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<SettingsBillingHeader firmName={access.staff.organizationName} pill={loaded.pill} tab={"retention"} />}
          statusbar={loaded.chrome.statusbar}
          after={deletion ? <DeletionDialog organizationId={deletion.organizationId} /> : undefined}
        >
          <SheetRetention data={loaded.page} />
          {deletion ? <RetentionDeletionPanels data={deletion} index={3} /> : null}
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
    const grantsDenied = grantsAccess(access.staff.role, tab);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<GrantsHeader tab={tab} pills={loaded.page.pills} />}
          statusbar={loaded.chrome.statusbar}
          after={
            <>
              <GrantDialog data={loaded.dialog} />
              {loaded.dialog.organizationId && access.staff.role === "firm_owner" ? <GrantRevokeDialog organizationId={loaded.dialog.organizationId} /> : null}
              {loaded.dialog.organizationId && access.staff.role === "firm_owner" && tab === "support" ? <SupportDeclineDialog organizationId={loaded.dialog.organizationId} /> : null}
            </>
          }
        >
          {/* DES-04: grants and support access answer the firm owner only; others see why, not empty lists. */}
          {grantsDenied ? <NoAccessPanel data={grantsDenied} /> : <SheetGrants data={loaded.page} />}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Automations: the built-in deadline-reminder rule (locked), the firm's own automations, and the reminder history.
  if (page === "automations" && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "runs" ? "runs" : "builder";
    const loaded = await loadSheetAutomations(access.staff, tab, undefined, query.rule);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<AutomationsHeader data={loaded.data} />}
          aside={<AutomationsSettings data={loaded.data} />}
          statusbar={loaded.chrome.statusbar}
          after={loaded.dialog ? <AutomationsDialog data={loaded.dialog} /> : undefined}
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
    redirect("/sheet/ai?from=settings");
  }
  if (page === "ai" && (access.kind === "live" || access.kind === "sample")) {
    const tab: AiTab = query.tab === "runs" || query.tab === "sources" || query.tab === "states" || query.tab === "rules" || query.tab === "audit" ? query.tab : "settings";
    const loaded = await loadSheetAi(access.staff, tab);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<AiHeader data={loaded.data} fromSettings={query.from === "settings"} />} statusbar={loaded.chrome.statusbar}>
          <SheetAi data={loaded.data} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Practice > Templates > What Casevoya supports (SRC-12): jurisdictions, programs and case types, supported only with an approved, sourced pack.
  if (page === "templates" && query.tab === "support" && (access.kind === "live" || access.kind === "sample")) {
    // DES-04: the catalogue cites program packs and their official pages; say when one is stale.
    const [loaded, stale] = await Promise.all([loadSheetSupportCatalogue(access.staff), loadSourceStaleness(access.staff, { kind: "firm" })]);
    return (
      <SheetScreen key={"templates-support"} page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<TemplatesHeader data={loaded.header} />} statusbar={loaded.chrome.statusbar}>
          {stale ? <StateAlert data={stale} /> : null}
          <SheetSupportCatalogue data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Practice > Templates: program and agreement templates, the approved email catalog, checklists, and the rule source register (read only).
  if (page === "templates" && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "messages" || query.tab === "checklists" || query.tab === "sources" || query.tab === "rule" || query.tab === "shared" ? query.tab : "program";
    // DES-04: where official content shows (program templates, Source review, a rule), say when its source is stale.
    const official = tab === "program" || tab === "sources" || tab === "rule";
    const [loaded, stale] = await Promise.all([
      loadSheetTemplates(access.staff, tab, query.view, undefined, { claim: query.claim, query: query.cq, offset: query.offset }),
      official ? loadSourceStaleness(access.staff, tab === "rule" && query.view ? { kind: "rule", ruleVersionId: query.view } : { kind: "firm" }) : null,
    ]);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<TemplatesHeader data={loaded.data} />}
          statusbar={loaded.chrome.statusbar}
          after={
            loaded.messageDialog ? (
              <>
                <MessageTemplateDialog data={loaded.messageDialog} />
                {loaded.messageDialog.edit ? <OpenOnLoad key={loaded.messageDialog.edit.id} id={"dlgMt"} /> : null}
              </>
            ) : tab === "sources" || tab === "rule" ? (
              // SRC-01/03: Add claim, and the review dialogs for the chosen version.
              <>
                {loaded.data.sources.addClaim ? <AddClaimDialog data={loaded.data.sources.addClaim} /> : null}
                {loaded.data.rule?.review ? <ClaimReviewDialogs review={loaded.data.rule.review} /> : null}
                {loaded.data.officialClaim ? <OfficialClaimDialogs view={loaded.data.officialClaim} /> : null}
              </>
            ) : undefined
          }
        >
          <StateAlerts items={[stale && tab === "sources" ? { ...stale, action: null } : stale, loaded.partial]} />
          <SheetTemplates data={loaded.data} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Practice > Intake forms: the versioned form builder (Build and Preview tabs).
  if (page === "intake-builder" && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "preview" ? "preview" : "build";
    const [loaded, share] = await Promise.all([loadSheetIntakeBuilder(access.staff, tab, { form: query.form, field: query.field }), loadEnquiryShare(access.staff)]);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={loaded.chrome.sidebar}
          header={<IntakeHeader data={loaded.data} share={Boolean(share)} />}
          aside={<IntakeSettings data={loaded.data} />}
          styles={[INTAKE_BUILDER_CSS]}
          statusbar={loaded.chrome.statusbar}
          after={share ? <EnquiryShareDialog data={share} /> : undefined}
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
              {clients.edit ? <PersonEditDialog data={{ maxBirthDate: todayIso(new Date(), access.staff.timezone) }} /> : null}
            </>
          }
        >
          <SheetClients data={clients} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Agreements: All agreements, one agreement's own view (Envelope, `?tab=envelope&view=<id>`),
  // Representation authority, the Quote builder (`?tab=quote&view=<id>`, its New quote dialog in
  // place of New agreement), the Agreement editor (`?tab=editor&view=<id>`) and Compare versions
  // (`?tab=compare&view=<id>`), each with a pick list when no agreement is chosen. Always this
  // firm's live shell, never the Designer's sample firm.
  if (page === "agreements" && (access.kind === "live" || access.kind === "sample")) {
    const loaded = await loadSheetAgreements(access.staff, query);
    const { chrome, header, dialog, templateDialog, countersign } = loaded;
    const voidDialog = loaded.envelope?.voidDialog ?? loaded.editor?.voidDialog ?? null;
    return (
      <SheetScreen key={`agreements-${loaded.tab}`} page={page}>
        <SheetFrame
          sidebar={chrome.sidebar}
          header={<AgreementsHeader data={header} />}
          statusbar={chrome.statusbar}
          after={
            <>
              {loaded.newQuote ? <NewQuoteDialog data={loaded.newQuote} /> : <NewAgreementDialog data={dialog} />}
              <TemplateDialog data={templateDialog} />
              {countersign.map((sign) => (
                <CountersignDialog key={sign.envelopeId} data={sign} />
              ))}
              {loaded.authority ? <AuthorityDialog data={loaded.authority.dialog} /> : null}
              {voidDialog ? <VoidEnvelopeDialog data={voidDialog} /> : null}
              {loaded.quote?.edit ? <QuoteEditDialog data={loaded.quote.edit} /> : null}
              {loaded.quote ? <QuotePreviewDialog data={loaded.quote.preview} /> : null}
              {loaded.quote?.convert ? <QuoteConvertDialog data={loaded.quote.convert} /> : null}
              {loaded.editor?.clauses.map((clause) => (
                <ClauseDialog key={clause.clauseId} data={clause} />
              ))}
            </>
          }
        >
          {loaded.authority ? (
            <SheetAgreementsAuthority data={loaded.authority.page} />
          ) : loaded.envelope ? (
            <SheetAgreementEnvelope data={loaded.envelope.page} />
          ) : loaded.quote ? (
            <SheetAgreementQuote data={loaded.quote.page} />
          ) : loaded.editor ? (
            <SheetAgreementEditor data={loaded.editor.page} />
          ) : loaded.compare ? (
            <SheetAgreementCompare data={loaded.compare.page} />
          ) : loaded.pick ? (
            <SheetAgreementsPick data={loaded.pick} />
          ) : loaded.pending ? (
            <SheetAgreementsPending data={loaded.pending} />
          ) : (
            <SheetAgreements data={loaded.page} />
          )}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Finance: Invoices, Payments, Client funds, Reconciliation, Refunds and disputes, and one
  // invoice's own tab (`?tab=invoice&view=<invoice id>`).
  if (
    page === "finance" &&
    (!query.tab || ["invoices", "payments", "funds", "recon", "refunds", "invoice", "balances"].includes(query.tab)) &&
    (access.kind === "live" || access.kind === "sample")
  ) {
    const invoiceId = query.tab === "invoice" && query.view && isUuid(query.view) ? query.view : null;
    const tab =
      query.tab === "payments" || query.tab === "funds" || query.tab === "refunds" || query.tab === "recon" || query.tab === "balances" ? query.tab : invoiceId ? "invoice" : "invoices";
    // DES-04: Finance is for the firm owner and finance staff; others see why instead of empty tables.
    const denied = financeAccess(access.staff.role);
    if (denied) return <NoAccessScreen page={page} staff={access.staff} path={"/sheet/finance"} denied={denied} />;
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
              {finance.creditDialog ? <CreditDialog data={finance.creditDialog} /> : null}
              {finance.evidenceDialog ? <EvidenceDialog data={finance.evidenceDialog} /> : null}
              {finance.funds ? <FundsLiveDialogs data={finance.funds.more} /> : null}
              {finance.invoiceView ? (
                <>
                  <CreditNoteDialog data={finance.invoiceView.creditDialog} />
                  {finance.invoiceView.reviewDialog ? <CreditReviewDialog data={finance.invoiceView.reviewDialog} /> : null}
                  {finance.invoiceView.voidDialog ? <VoidDialog data={finance.invoiceView.voidDialog} /> : null}
                  {finance.invoiceView.manualDialogs ? <ManualPaymentDialogs data={finance.invoiceView.manualDialogs} /> : null}
                </>
              ) : null}
              {finance.recon ? <ReconDialogs data={finance.recon.dialogs} /> : null}
              {finance.recon?.itemDialog ? <ReconItemDialog data={finance.recon.itemDialog} /> : null}
              {finance.billing ? <FinanceBillingDialogs data={finance.billing} /> : null}
              {finance.invoiceBilling ? <InvoiceBillingDialogs data={finance.invoiceBilling} /> : null}
            </>
          }
        >
          <StateAlerts items={finance.states} />
          {finance.openingBalances ? (
            <OpeningBalancesPanel organizationId={access.staff.organizationId} rows={finance.openingBalances.rows} failed={finance.openingBalances.failed} />
          ) : finance.invoiceView ? (
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
            <SheetFinance data={finance.page} after={finance.billing ? <FinanceBillingPanels data={finance.billing} /> : null} />
          )}
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Consultations: Upcoming, Availability, Booking page and Consultation record tabs (BUILD-SPEC §4).
  // The record tab shows a real booking's notes (on its lead), outcome and details.
  if (page === "consultations" && (access.kind === "live" || access.kind === "sample")) {
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
              {loaded.summaryDialog ? <SummaryDialog data={loaded.summaryDialog} /> : null}
              <AvailabilityDialog organizationId={loaded.settings.organizationId} zones={loaded.settings.zones} />
              {loaded.settings.owner ? <BookingTypeDialog organizationId={loaded.settings.organizationId} hosts={loaded.settings.hosts} practice={loaded.settings.practice} agreements={loaded.settings.agreements} /> : null}
            </>
          }
        >
          {loaded.record ? <SheetConsultationRecord data={loaded.record} /> : <SheetConsultations data={loaded.page} />}
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
          header={<CalendarHeader tab={loaded.tab} pills={loaded.pills} create={{ "data-nav": "/sheet/consultations?dlg=book" }} nav={loaded.nav} />}
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
    // DES-04: a matter this person can't open says so (and who to ask), instead of a bare 404.
    if (!loaded)
      return (
        <NoAccessScreen page={page} staff={access.staff} path={"/sheet/government"} denied={recordNotOpen("matter", access.staff.role, { label: "Government status", href: "/sheet/government" })} />
      );
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={loaded.chrome.sidebar} header={<GovernmentHeader data={loaded.header} />} styles={GOVERNMENT_CSS} statusbar={loaded.chrome.statusbar}>
          {loaded.stale ? <StateAlert data={loaded.stale} /> : null}
          <SheetGovernment data={loaded.page} />
        </SheetFrame>
      </SheetScreen>
    );
  }
  // Leads: the pipeline (Board, List, Timeline) and one lead (`/sheet/lead?id=`).
  if (page === "pipeline" && (access.kind === "live" || access.kind === "sample")) {
    const [loaded, share] = await Promise.all([loadSheetPipeline(access.staff, query), loadEnquiryShare(access.staff)]);
    return (
      <SheetScreen page={page}>
        <PipelineScreen loaded={loaded} share={share} />
      </SheetScreen>
    );
  }
  if (page === "lead" && (access.kind === "live" || access.kind === "sample")) {
    // The Designer's + Lead goes to /sheet/lead?new=1: New lead is a dialog on the pipeline.
    if (!query.id) redirect("/sheet/pipeline?new=1");
    const [loaded, vo] = await Promise.all([loadSheetLead(access.staff, query.id, { conflict: query.dlg === "conflict" }), loadLeadVo(access.staff, query.id)]);
    if (!loaded) {
      if (!isUuid(query.id)) notFound();
      return <NoAccessScreen page={page} staff={access.staff} path={"/sheet/pipeline"} denied={recordNotOpen("lead", access.staff.role, { label: "Pipeline", href: "/sheet/pipeline" })} />;
    }
    return (
      <SheetScreen page={page}>
        <LeadScreen loaded={loaded} vo={vo} />
      </SheetScreen>
    );
  }
  if (page === "matter" && (access.kind === "live" || access.kind === "sample")) {
    // DES-04: the matter's official content (its program pack and the rules its deadlines came from) when stale.
    const [loaded, stale] = await Promise.all([
      matterId ? loadSheetMatter(access.staff, matterId, query) : null,
      matterId && isUuid(matterId) ? loadSourceStaleness(access.staff, { kind: "matter", matterId }) : null,
    ]);
    if (!loaded) {
      if (!matterId || !isUuid(matterId)) notFound();
      return <NoAccessScreen page={page} staff={access.staff} path={"/sheet/matters"} denied={recordNotOpen("matter", access.staff.role, { label: "All matters", href: "/sheet/matters" })} />;
    }
    const officialTab = ["overview", "forms", "documents", "submissions", "tasks"].includes(loaded.page.tab);
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
              {loaded.letterDialogs ? <MatterLetterDialogs data={loaded.letterDialogs} /> : null}
              {loaded.page.billing?.work ? <MatterWorkDialogs data={loaded.page.billing.work} /> : null}
              {loaded.countersign.map((sign) => (
                <CountersignDialog key={sign.envelopeId} data={sign} />
              ))}
            </>
          }
          statusbar={loaded.chrome.statusbar}
        >
          {stale && officialTab ? <StateAlert data={stale} /> : null}
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

/**
 * DES-04: a page or a record this person's role can't open, in the firm's own frame: the shared
 * permission-denied view says what's missing and who to ask, never a blank table or a bare 404.
 */
async function NoAccessScreen({ page, staff, path, denied }: { page: string; staff: SheetStaff; path: string; denied: NoAccessData }) {
  const chrome = await loadSheetChrome(staff, path);
  return (
    <SheetScreen page={page}>
      <SheetFrame sidebar={chrome.sidebar} top={chrome.top} statusbar={chrome.statusbar}>
        <NoAccessPanel data={denied} />
      </SheetFrame>
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
    month: one("month"),
    thread: one("thread"),
    form: one("form"),
    field: one("field"),
    id: one("id"),
    stage: one("stage"),
    owner: one("owner"),
    vo: one("vo"),
    from: one("from"),
    program: one("program"),
    claim: one("claim"),
    cq: one("cq"),
    rule: one("rule"),
    offset: one("offset"),
  };
}
