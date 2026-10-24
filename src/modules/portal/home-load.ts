import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadPortalDocuments } from "@/modules/documents/load";
import { loadPortalInvoices } from "@/modules/finance/portal-load";
import { loadPortalMessages } from "@/modules/messages/load";
import type { PortalViewer } from "@/modules/portal/load";
import { homeView, matterCards, type HomeView, type MatterCard } from "@/modules/portal/home-present";
import { loadPortalGovernment } from "@/modules/portal/government-load";
import { loadPortalRenewals } from "@/modules/portal/renewal-load";
import { loadPortalFollowUp } from "@/modules/decisions/portal-load";
import { portalNotices, type PortalNotice } from "@/modules/portal/notices";
import { loadPortalTasks, type PortalTask } from "@/modules/portal/tasks-load";

/**
 * The client's Home: their next step, the summary strip, where the latest matter stands, the
 * documents they sent, the latest message and the next bill. A part that fails to load shows as
 * empty rather than breaking the page.
 */
export async function loadPortalHome(viewer: PortalViewer, tasks: PortalTask[] | null): Promise<HomeView> {
  const matter = viewer.matters[0] ?? null;
  const [taskRows, documents, invoices, messages, consultant, government, renewals, followUp] = await Promise.all([
    tasks ? Promise.resolve(tasks) : loadPortalTasks(viewer).catch(() => []),
    loadPortalDocuments(viewer).catch(() => null),
    loadPortalInvoices(viewer).catch(() => null),
    loadPortalMessages(viewer, null).catch(() => null),
    matter ? loadPortalConsultants(viewer).then((names) => names.get(matter.id) ?? null) : Promise.resolve(null),
    loadPortalGovernment(viewer, matter?.id ?? null),
    // DEC-02: renewal reminders the firm set (portal only).
    loadPortalRenewals(viewer),
    loadPortalFollowUp(viewer, matter?.id ?? null),
  ]);
  const view = homeView({
    firmName: viewer.organizationName,
    personName: viewer.person?.displayName ?? null,
    timezone: viewer.timezone,
    now: new Date(),
    matter,
    consultant,
    tasks: taskRows,
    documents: documents?.cards ?? [],
    invoices: invoices?.invoices ?? [],
    messages,
  });
  // GOV-05: statuses the firm shared, "Recorded by <firm> on <date>".
  const withGovernment = government.length ? { ...view, government } : view;
  const withRenewals = renewals.length ? { ...withGovernment, renewals } : withGovernment;
  // DEC-02: the firm's approved conditions summary and the decision documents delivered.
  return followUp ? { ...withRenewals, followUp } : withRenewals;
}

/** My matters: one card per matter, with the client's open tasks and each matter's consultant. */
export async function loadPortalMatters(viewer: PortalViewer): Promise<MatterCard[]> {
  const [tasks, consultants] = await Promise.all([loadPortalTasks(viewer).catch(() => []), loadPortalConsultants(viewer)]);
  return matterCards({ matters: viewer.matters, tasks, consultants, timezone: viewer.timezone });
}

/** Each of the client's matters and its responsible consultant's name (public.portal_matter_consultants). */
async function loadPortalConsultants(viewer: PortalViewer): Promise<Map<string, string | null>> {
  try {
    const supabase = await createClient({ organizationId: viewer.organizationId });
    const { data } = await supabase.rpc("portal_matter_consultants", { p_org: viewer.organizationId });
    return new Map((data ?? []).map((row) => [row.matter_id, row.consultant_name]));
  } catch {
    return new Map();
  }
}

/** ORG-06 and OPS-04: the signed-in person's own portal notices (consultant changed, announcements); none when unreadable. */
export async function loadPortalNotices(viewer: PortalViewer): Promise<PortalNotice[]> {
  try {
    const supabase = await createClient({ organizationId: viewer.organizationId });
    const { data, error } = await supabase.rpc("portal_notices_for_me", { p_org: viewer.organizationId });
    if (error) return [];
    const notices = portalNotices(data, viewer.organizationName);
    // OPS-04: the announcements on Home are now seen (staff see how many read each one).
    if (Array.isArray(data) && data.some((row) => row && typeof row === "object" && (row as { kind?: unknown }).kind === "announcement")) {
      await supabase.rpc("mark_portal_announcements_seen", { p_org: viewer.organizationId });
    }
    return notices;
  } catch {
    return [];
  }
}
