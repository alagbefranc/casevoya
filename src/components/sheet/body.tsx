import { notFound, redirect } from "next/navigation";
import { DemoSheet } from "@/components/sheet/demo";
import { AgreementsHeader, CountersignDialog, NewAgreementDialog, SheetAgreements, TemplateDialog } from "@/components/sheet/designer/agreements";
import { ClientsHeader, DuplicateDialog, SheetClients } from "@/components/sheet/designer/clients";
import { FinanceHeader, NewInvoiceDialog, SheetFinance, SheetFinancePayments } from "@/components/sheet/designer/finance";
import { SheetFrame } from "@/components/sheet/designer/frame";
import { StripeConnectPanel } from "@/components/sheet/stripe-connect";
import { SheetHome } from "@/components/sheet/designer/home";
import { MatterDialogs, MatterRbar, MatterTopBar, SheetMatter } from "@/components/sheet/designer/matter";
import { MATTER_CSS } from "@/components/sheet/designer/matter-css";
import { MattersTopBar, NewMatterDialog, SheetMatters } from "@/components/sheet/designer/matters";
import { PersonEditDialog } from "@/components/sheet/designer/person-edit";
import { SampleCasePanel } from "@/components/sheet/designer/sample-case";
import { SAMPLE_CASE_CSS } from "@/components/sheet/designer/sample-case-css";
import { SheetStaffTab, StaffAfter, StaffHeader } from "@/components/sheet/designer/invitations";
import { PolicyMissingAlert, PortalPoliciesAfter, SettingsPortalHeader, SheetPortalPolicies } from "@/components/sheet/designer/portal-policies";
import { SheetTasks, TasksDialog, TasksHeader } from "@/components/sheet/designer/tasks";
import { LiveSheet, QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { SHEET_MARKUP, type SheetPage } from "@/components/sheet/markup/registry";
import { homeRoute } from "@/lib/auth/home-route";
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
import { loadSheetAccess, loadSheetBundle } from "@/modules/sheet/load";
import type { SheetQuery } from "@/modules/sheet/present";

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
  // Finance, Invoices and Payments tabs. Client funds, reconciliation, refunds and the single
  // invoice view are not ported yet and keep their old view.
  if (page === "finance" && (!query.tab || query.tab === "invoices" || query.tab === "payments") && (access.kind === "live" || access.kind === "sample")) {
    const tab = query.tab === "payments" ? "payments" : "invoices";
    const finance = await loadSheetFinance(access.staff, tab);
    return (
      <SheetScreen page={page}>
        <SheetFrame
          sidebar={finance.chrome.sidebar}
          header={<FinanceHeader data={finance.header} />}
          statusbar={finance.chrome.statusbar}
          after={<NewInvoiceDialog data={finance.dialog} />}
        >
          {tab === "payments" ? (
            <SheetFinancePayments
              intro={`Clients pay ${finance.account.firmName}’s invoices by card into the firm’s own Stripe account. Stripe runs in test mode: no real card is charged. Casevoya never holds the money.`}
            >
              <StripeConnectPanel data={finance.account} />
            </SheetFinancePayments>
          ) : (
            <SheetFinance data={finance.page} />
          )}
        </SheetFrame>
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
  };
}
