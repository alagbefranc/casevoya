import { notFound } from "next/navigation";
import { DemoSheet } from "@/components/sheet/demo";
import { LiveSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { SHEET_MARKUP, type SheetPage } from "@/components/sheet/markup/registry";
import { loadFinanceSnapshot } from "@/modules/finance/load";
import { loadSheetBundle, loadSheetStaff } from "@/modules/sheet/load";
import type { SheetQuery } from "@/modules/sheet/present";

const PUBLIC = new Set(["enquiry", "book"]);

export function isSheetPage(page: string): page is SheetPage {
  return page in SHEET_MARKUP;
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
  const staff = PUBLIC.has(page) ? null : await loadSheetStaff();
  if (!staff) {
    if (page === "matter" && matterId && matterId !== "priya") notFound();
    return (
      <SheetScreen page={page} tone={tone}>
        <DemoSheet page={page} query={query} />
      </SheetScreen>
    );
  }
  const bundle = await loadSheetBundle(staff);
  const finance = page === "finance" || page === "matter" || page === "settings"
    ? await loadFinanceSnapshot(staff.organizationId, page === "matter" ? matterId ?? null : null)
    : null;
  return (
    <SheetScreen page={page}>
      <LiveSheet bundle={bundle} page={page} tab={query.tab} view={query.view} query={query.q} matterId={matterId} finance={finance} />
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
  };
}
