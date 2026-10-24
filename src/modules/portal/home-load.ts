import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadPortalDocuments } from "@/modules/documents/load";
import { loadPortalInvoices } from "@/modules/finance/portal-load";
import { loadPortalMessages } from "@/modules/messages/load";
import type { PortalViewer } from "@/modules/portal/load";
import { homeView, type HomeView } from "@/modules/portal/home-present";
import { loadPortalTasks, type PortalTask } from "@/modules/portal/tasks-load";

/**
 * The client's Home: their next step, the summary strip, where the latest matter stands, the
 * documents they sent, the latest message and the next bill. A part that fails to load shows as
 * empty rather than breaking the page.
 */
export async function loadPortalHome(viewer: PortalViewer, tasks: PortalTask[] | null): Promise<HomeView> {
  const matter = viewer.matters[0] ?? null;
  const [taskRows, documents, invoices, messages, consultant] = await Promise.all([
    tasks ? Promise.resolve(tasks) : loadPortalTasks(viewer).catch(() => []),
    loadPortalDocuments(viewer).catch(() => null),
    loadPortalInvoices(viewer).catch(() => null),
    loadPortalMessages(viewer, null).catch(() => null),
    matter ? consultantFor(viewer, matter.id) : Promise.resolve(null),
  ]);
  return homeView({
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
}

/** The responsible consultant's name on this matter (public.portal_matter_consultants), or null. */
async function consultantFor(viewer: PortalViewer, matterId: string): Promise<string | null> {
  try {
    const supabase = await createClient({ organizationId: viewer.organizationId });
    const { data } = await supabase.rpc("portal_matter_consultants", { p_org: viewer.organizationId });
    return (data ?? []).find((row) => row.matter_id === matterId)?.consultant_name ?? null;
  } catch {
    return null;
  }
}
