import { notFound, redirect } from "next/navigation";
import { DemoSheet } from "@/components/sheet/demo";
import { SheetFrame } from "@/components/sheet/designer/frame";
import { SheetHome } from "@/components/sheet/designer/home";
import { MatterDialogs, MatterRbar, MatterTopBar, SheetMatter } from "@/components/sheet/designer/matter";
import { MATTER_CSS } from "@/components/sheet/designer/matter-css";
import { MattersTopBar, SheetMatters } from "@/components/sheet/designer/matters";
import { SampleCasePanel } from "@/components/sheet/designer/sample-case";
import { SAMPLE_CASE_CSS } from "@/components/sheet/designer/sample-case-css";
import { LiveSheet, QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { SHEET_MARKUP, type SheetPage } from "@/components/sheet/markup/registry";
import { homeRoute } from "@/lib/auth/home-route";
import { signInLocation } from "@/lib/auth/redirect";
import { loadSheetHome } from "@/modules/sheet/home-load";
import { loadSheetMatter } from "@/modules/sheet/matter-load";
import { loadSheetMatters } from "@/modules/sheet/matters-load";
import { loadSheetSample } from "@/modules/sheet/sample-load";
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
    const { chrome, rbar, home } = await loadSheetHome(access.staff);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} top={chrome.top} rbar={rbar} statusbar={chrome.statusbar}>
          <SheetHome data={home} />
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
    const { chrome, matters } = await loadSheetMatters(access.staff, query);
    return (
      <SheetScreen page={page}>
        <SheetFrame sidebar={chrome.sidebar} header={<MattersTopBar counts={matters.counts} />} statusbar={chrome.statusbar}>
          <SheetMatters data={matters} />
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
          after={<MatterDialogs data={loaded.dialogs} />}
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
  };
}
