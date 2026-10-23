import "server-only";
import type { ExportJob, ExportRow, ExportsData } from "@/components/sheet/designer/exports";
import { isUuid } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome, matterNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import type { SheetQuery } from "@/modules/sheet/present";
import { byteSize, excludedWarning, exportState, jobSteps } from "@/modules/sheet/exports-present";

const EXPORT_ROLES = new Set(["firm_owner", "licensed_consultant", "case_manager"]);
const MATTERS_OFFERED = 200;
const HISTORY = 50;

export const EXPORT_NOTE =
  "Each export includes the matter record, people, tasks, deadlines, stage history, agreements, invoices and payments, client-account entries, document requests and files (up to 200 files and 40 MB; anything over is listed in the manifest), the audit trail, and a manifest with the SHA-256 of every file. Download links last 24 hours; start a new export any time.";

function stamp(iso: string, timeZone: string, withTime = true): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return withTime ? `${get("day")} ${get("month")} ${get("hour")}:${get("minute")}` : `${get("day")} ${get("month")}`;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** The Designer's Client-file exports page for a firm, read as the signed-in staff member (RLS decides the jobs and matters). */
export async function loadSheetExports(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const chosen = query.view && isUuid(query.view) ? query.view : null;
  const canExport = EXPORT_ROLES.has(staff.role);

  const [chrome, jobs, matters, members] = await Promise.all([
    loadSheetChrome(staff, "/sheet/exports"),
    supabase
      .from("matter_exports")
      .select("id, matter_id, status, stage, progress, requested_by, requested_at, file_count, byte_size, ready_at, expires_at, failure_reason, last_downloaded_at, excluded")
      .eq("organization_id", org)
      .order("requested_at", { ascending: false })
      .limit(HISTORY),
    canExport
      ? supabase.from("matters").select("id, reference, title, is_sample").eq("organization_id", org).order("updated_at", { ascending: false }).limit(MATTERS_OFFERED)
      : null,
    supabase.from("memberships").select("user_id").eq("organization_id", org),
  ]);
  const jobRows = jobs.data ?? [];
  const matterRows = matters?.data ?? [];
  const ids = [...new Set([...jobRows.map((row) => row.matter_id), ...matterRows.map((row) => row.id)])];
  const [name, refs, profiles] = await Promise.all([
    matterNames(supabase, org, ids),
    jobRows.length ? supabase.from("matters").select("id, reference").eq("organization_id", org).in("id", [...new Set(jobRows.map((row) => row.matter_id))]) : null,
    (members.data ?? []).length ? supabase.from("profiles").select("id, display_name").in("id", [...new Set((members.data ?? []).map((row) => row.user_id))]) : null,
  ]);
  const referenceOf = new Map([...(refs?.data ?? []), ...matterRows].map((row) => [row.id, row.reference]));
  const person = new Map((profiles?.data ?? []).map((row) => [row.id, row.display_name]));
  const ref = (id: string) => referenceOf.get(id) || name(id);
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub ?? null;
  const isOwner = staff.role === "firm_owner";
  const open = (row: (typeof jobRows)[number]) => row.status === "ready" && row.expires_at !== null && Date.parse(row.expires_at) > now.getTime();
  const mayDownload = (row: (typeof jobRows)[number]) => open(row) && (row.requested_by === userId || isOwner);

  const excludedOf = (row: (typeof jobRows)[number]) => (Array.isArray(row.excluded) ? (row.excluded as { path?: unknown; reason?: unknown }[]) : []);
  const rows: ExportRow[] = jobRows.map((row) => ({
    key: row.id,
    started: stamp(row.requested_at, staff.timezone),
    matter: ref(row.matter_id),
    by: person.get(row.requested_by) || "A former member",
    files: row.file_count === null ? "—" : String(row.file_count),
    size: byteSize(row.byte_size),
    state: exportState(
      {
        status: row.status,
        expiresAt: row.expires_at,
        lastDownloadedOn: row.last_downloaded_at ? stamp(row.last_downloaded_at, staff.timezone, false) : null,
        failureReason: row.failure_reason,
        expiresLabel: row.expires_at ? stamp(row.expires_at, staff.timezone) : null,
        excludedCount: excludedOf(row).length,
      },
      now,
    ),
    attrs: mayDownload(row) ? { "data-export-act": "download", "data-export": row.id } : undefined,
  }));

  const building = jobRows.find((row) => row.status === "building");
  const ready = jobRows.find((row) => mayDownload(row));
  const shown = building ?? ready ?? null;
  const job: ExportJob | null = shown
    ? {
        title: [ref(shown.matter_id), name(shown.matter_id), shown.status === "building" ? "running" : "ready"],
        steps: jobSteps({
          progress: shown.progress,
          status: shown.status,
          files: shown.file_count,
          started: clock(shown.requested_at, staff.timezone),
          ready: shown.ready_at ? clock(shown.ready_at, staff.timezone) : null,
        }),
        progress: shown.status === "ready" ? 100 : shown.progress,
        action:
          shown.status === "building"
            ? { kind: "cancel", attrs: { "data-export-act": "cancel", "data-export": shown.id, "data-org": org } }
            : { kind: "download", attrs: { "data-export-act": "download", "data-export": shown.id } },
      }
    : null;

  const latestReady = jobRows.find((row) => row.status === "ready");
  const warning = latestReady ? excludedWarning(ref(latestReady.matter_id), excludedOf(latestReady)) : null;

  // A matter linked to directly (its Closure tab's Export the client file), even one older than
  // the matters listed.
  const chosenMatter = chosen
    ? (matterRows.find((row) => row.id === chosen) ??
      (canExport ? ((await supabase.from("matters").select("id, reference, title, is_sample").eq("organization_id", org).eq("id", chosen).maybeSingle()).data ?? undefined) : undefined))
    : undefined;
  const exports: ExportsData = {
    header: { newAttrs: { "data-export-act": "new" } },
    job,
    rows,
    note: EXPORT_NOTE,
    warning,
    dialog: {
      // The chosen matter is the only one offered, so the dialog still names what is exported.
      matters: chosenMatter
        ? [{ value: chosenMatter.id, label: `${chosenMatter.reference ? `${chosenMatter.reference} · ` : ""}${chosenMatter.title}${chosenMatter.is_sample ? " (sample)" : ""}` }]
        : matterRows.map((row) => ({ value: row.id, label: `${row.reference ?? row.title} · ${name(row.id)}${row.is_sample ? " (sample)" : ""}` })),
      confirm: {
        "data-export-act": "confirm",
        "data-org": org,
        ...(chosenMatter ? { "data-matter": chosenMatter.id } : {}),
        ...(canExport ? {} : { disabled: "" }),
      },
    },
  };
  return { chrome, exports };
}
