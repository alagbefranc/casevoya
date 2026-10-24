import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DemoPortal, PORTAL_SLUGS } from "@/components/portal/demo";
import { EmptyPortal, LivePortal, PortalLoading } from "@/components/portal/live";
import { PortalScreen } from "@/components/portal/screen";
import { PORTAL_MATTER_COOKIE, RememberMatter } from "@/components/portal/remember-matter";
import { signInLocation } from "@/lib/auth/redirect";
import { loadPortalAgreements } from "@/modules/agreements/load";
import { loadPortalDocuments } from "@/modules/documents/load";
import { loadPortalInvoices } from "@/modules/finance/portal-load";
import { isUuid } from "@/lib/tenant/context";
import { countPortalUnread, loadPortalMessages } from "@/modules/messages/load";
import { firmLogo } from "@/modules/firm-onboarding/public-logo";
import { loadPortalHome, loadPortalMatters } from "@/modules/portal/home-load";
import { loadPortalAccess } from "@/modules/portal/load";
import { payStateFromQuery } from "@/modules/portal/pay";
import { loadPortalAppointments } from "@/modules/scheduling/portal-load";
import { loadPortalIntake } from "@/modules/intake/portal-load";
import { countPortalTasks, loadPortalTasks } from "@/modules/portal/tasks-load";

export const metadata: Metadata = {
  title: "Portal · Casevoya",
  robots: { index: false, follow: false },
};

const LIVE = new Set(["home", ...PORTAL_SLUGS]);
const PERSONA = new Set(["olena", "rafael"]);

async function Body({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ state?: string | string[]; invoice?: string | string[]; thread?: string | string[]; response?: string | string[]; field?: string | string[]; matter?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const page = slug?.[0] ?? "home";
  if (slug && slug.length > 1) notFound();
  if (page !== "home" && !LIVE.has(page)) notFound();
  const stateValue = Array.isArray(query.state) ? query.state[0] : query.state;
  const next = page === "home" ? "/portal" : `/portal/${page}`;
  const access = await loadPortalAccess();
  if (access.kind === "signed-out") redirect(signInLocation(next));
  if (access.kind === "sample") {
    return (
      <PortalScreen page={page}>
        <DemoPortal page={page} state={payStateFromQuery(stateValue)} />
      </PortalScreen>
    );
  }
  if (PERSONA.has(page)) notFound();
  if (access.kind !== "live") {
    return (
      <PortalScreen page={page}>
        <EmptyPortal />
      </PortalScreen>
    );
  }
  // The current matter: My matters → Open (?matter=), else the one the client opened last (a
  // cookie), else the most recently updated. It goes first, so Home and the pill show it.
  const matterValue = Array.isArray(query.matter) ? query.matter[0] : query.matter;
  const remembered = (await cookies()).get(PORTAL_MATTER_COOKIE)?.value;
  const pick = (id: string | undefined) => (isUuid(id) ? access.viewer.matters.find((matter) => matter.id === id) : undefined);
  const opened = pick(matterValue);
  const chosen = opened ?? pick(remembered);
  if (chosen) access.viewer.matters = [chosen, ...access.viewer.matters.filter((matter) => matter !== chosen)];
  const documents = page === "documents" || page === "upload" ? await loadPortalDocuments(access.viewer) : null;
  const agreements = page === "agreements" ? await loadPortalAgreements(access.viewer) : null;
  const invoiceValue = Array.isArray(query.invoice) ? query.invoice[0] : query.invoice;
  const payments =
    page === "payments" || page === "pay"
      ? { data: await loadPortalInvoices(access.viewer), invoiceId: isUuid(invoiceValue) ? invoiceValue : null }
      : null;
  const appointments = page === "appointments" ? await loadPortalAppointments(access.viewer) : null;
  const threadValue = Array.isArray(query.thread) ? query.thread[0] : query.thread;
  // A failed read shows the chat's error state (null), not a broken page.
  const messages = page === "messages" ? await loadPortalMessages(access.viewer, threadValue ?? null).catch(() => null) : undefined;
  // Intake delivery: the person's own forms (?response= opens one) and client tasks.
  const responseValue = Array.isArray(query.response) ? query.response[0] : query.response;
  const fieldValue = Array.isArray(query.field) ? query.field[0] : query.field;
  const intake =
    page === "intake" || page === "correction"
      ? await loadPortalIntake(access.viewer, responseValue ?? null)
          .then((data) => ({ data, field: fieldValue && /^[a-z][a-z0-9_]{0,63}$/.test(fieldValue) ? fieldValue : null }))
          .catch(() => null)
      : null;
  const tasks = page === "tasks" ? await loadPortalTasks(access.viewer).catch(() => null) : null;
  // The sidebar on every page: the firm's logo, and the Tasks and Messages counts.
  const [taskCount, unread, logo, home] = await Promise.all([
    tasks ? tasks.filter((task) => task.status !== "done").length : countPortalTasks(access.viewer).catch(() => 0),
    countPortalUnread(access.viewer).catch(() => 0),
    firmLogo(access.viewer.organizationSlug),
    page === "home" ? loadPortalHome(access.viewer, null).catch(() => null) : null,
  ]);
  const matters = page === "matters" ? await loadPortalMatters(access.viewer).catch(() => null) : null;
  return (
    <PortalScreen page={page}>
      <LivePortal
        page={page}
        viewer={access.viewer}
        documents={documents}
        agreements={agreements}
        payments={payments}
        appointments={appointments}
        messages={messages}
        intake={intake}
        tasks={tasks}
        taskCount={taskCount}
        unread={unread}
        home={home}
        logo={logo}
        matters={matters}
      />
      {opened ? <RememberMatter id={opened.id} /> : null}
    </PortalScreen>
  );
}

export default function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ state?: string | string[]; invoice?: string | string[]; thread?: string | string[]; response?: string | string[]; field?: string | string[]; matter?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<PortalScreen page="home"><PortalLoading /></PortalScreen>}>
      <Body params={params} searchParams={searchParams} />
    </Suspense>
  );
}
