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
import type { PortalPart } from "@/modules/portal/states";

/**
 * The client's Home: their next step, the summary strip, where the latest matter stands, the
 * documents they sent, the latest message and the next bill. DES-04: a part that fails to load
 * doesn't break the page, and isn't shown as empty either: it is named in `unavailable`, so Home
 * says it couldn't be shown (a partial state) instead of "nothing to pay".
 */
export async function loadPortalHome(viewer: PortalViewer, tasks: PortalTask[] | null): Promise<HomeView> {
  const matter = viewer.matters[0] ?? null;
  const unavailable: PortalPart[] = [];
  const part = <T,>(name: PortalPart, load: Promise<T>, fallback: T): Promise<T> =>
    load.catch(() => {
      unavailable.push(name);
      return fallback;
    });
  const [taskRows, documents, invoices, messages, consultant, government, renewals, followUp] = await Promise.all([
    tasks ? Promise.resolve(tasks) : part("tasks", loadPortalTasks(viewer), [] as PortalTask[]),
    part("documents", loadPortalDocuments(viewer), null),
    part("payments", loadPortalInvoices(viewer), null),
    part("messages", loadPortalMessages(viewer, null), null),
    matter ? part("consultant", loadPortalConsultants(viewer, true).then((names) => names.get(matter.id) ?? null), null) : Promise.resolve(null),
    part("updates from your firm", loadPortalGovernment(viewer, matter?.id ?? null), []),
    // DEC-02: renewal reminders the firm set (portal only).
    part("renewal reminders", loadPortalRenewals(viewer), []),
    part("decision documents", loadPortalFollowUp(viewer, matter?.id ?? null), null),
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
  const withFollowUp = followUp ? { ...withRenewals, followUp } : withRenewals;
  return unavailable.length ? { ...withFollowUp, unavailable } : withFollowUp;
}

/**
 * My matters: one card per matter, with the client's open tasks and each matter's consultant.
 * DES-04: `unavailable` names a part that couldn't be read (the cards then lack it, said plainly).
 */
export async function loadPortalMatters(viewer: PortalViewer): Promise<{ cards: MatterCard[]; unavailable: PortalPart[] }> {
  const unavailable: PortalPart[] = [];
  const [tasks, consultants] = await Promise.all([
    loadPortalTasks(viewer).catch(() => {
      unavailable.push("tasks");
      return [] as PortalTask[];
    }),
    loadPortalConsultants(viewer, true).catch(() => {
      unavailable.push("consultant");
      return new Map<string, string | null>();
    }),
  ]);
  return { cards: matterCards({ matters: viewer.matters, tasks, consultants, timezone: viewer.timezone }), unavailable };
}

/**
 * Each of the client's matters and its responsible consultant's name (public.portal_matter_consultants).
 * `strict`: an unreadable answer throws (DES-04 partial state) instead of reading as "no consultant".
 */
async function loadPortalConsultants(viewer: PortalViewer, strict = false): Promise<Map<string, string | null>> {
  try {
    const supabase = await createClient({ organizationId: viewer.organizationId });
    const { data, error } = await supabase.rpc("portal_matter_consultants", { p_org: viewer.organizationId });
    if (error) throw new Error("portal consultants unreadable");
    return new Map((data ?? []).map((row) => [row.matter_id, row.consultant_name]));
  } catch (cause) {
    if (strict) throw cause;
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
