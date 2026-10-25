import type { Metadata } from "next";
import { Suspense } from "react";
import { BOOK_PAGE_CSS } from "@/components/sheet/designer/book";
import { CatalogueName } from "@/components/sheet/designer/support-catalogue";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { supportCatalogue, type CatalogueRow, type SupportCatalogueJson } from "@/modules/sheet/support-catalogue-present";

export const metadata: Metadata = {
  title: "What Casevoya supports · Casevoya",
};

const TIME_ZONE = "America/Toronto";

function Section({ title, rows, empty }: { title: string; rows: CatalogueRow[]; empty: string }) {
  return (
    <section style={{ marginTop: "28px" }}>
      <h2 style={{ fontSize: "20px", margin: "0 0 10px" }}>{title}</h2>
      {rows.length === 0 ? (
        <p style={{ margin: 0, color: "#615d59" }}>{empty}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "12px" }}>
          {rows.map((row) => (
            <li key={row.key} data-scope={row.key} style={{ borderTop: "1px solid #e6e3df", paddingTop: "10px" }}>
              <div style={{ display: "flex", gap: "12px", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
                <b>
                  <CatalogueName row={row} />
                </b>
                <span style={{ fontSize: "14px", fontWeight: 600, color: row.badge.tone === "ok" ? "#2e7d4f" : "#615d59" }}>{row.badge.label}</span>
              </div>
              {row.facts.length ? <div style={{ fontSize: "13px", color: "#615d59" }}>{row.facts.join(" · ")}</div> : null}
              <p style={{ margin: "4px 0 0", fontSize: "14px", lineHeight: 1.5 }}>{row.detail}</p>
              {row.flags?.map((flag, n) => (
                <p key={n} data-flag={"1"} style={{ margin: "4px 0 0", fontSize: "14px", lineHeight: 1.5, color: "#8a5a00" }}>
                  {flag}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function Body() {
  let json: SupportCatalogueJson | null = null;
  if (hasPublicSupabaseEnv()) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("support_catalogue", {});
      json = error || !data || typeof data !== "object" ? null : (data as SupportCatalogueJson);
    } catch {
      json = null;
    }
  }
  if (!json) {
    return (
      <SheetScreen page="book" tone="public">
        <QuietSheet title="What Casevoya supports" copy="The catalogue couldn’t be read just now. Try again in a moment." />
      </SheetScreen>
    );
  }
  const data = supportCatalogue(json, { timeZone: TIME_ZONE, staff: false });
  // The booking page's frame (.pb), as the public privacy notice uses it.
  return (
    <SheetScreen page="book" tone="public">
      <style dangerouslySetInnerHTML={{ __html: BOOK_PAGE_CSS }} />
      <div className="pb">
        <header>
          <span>Casevoya</span>
        </header>
        <main id="m" style={{ display: "block", maxWidth: "760px" }}>
          <h1>What Casevoya supports</h1>
          <p className="lead">{data.intro}</p>
          <Section title="Programs" rows={data.programs} empty="No programs are listed yet. A program is supported once Casevoya has live official claims for its forms or checklists." />
          <Section title="Jurisdictions" rows={data.jurisdictions} empty="No jurisdictions are listed." />
          <Section title="Case types" rows={data.caseTypes} empty="No case types are listed." />
          <div style={{ marginTop: "28px", display: "grid", gap: "8px", color: "#615d59", fontSize: "14px", lineHeight: 1.5 }}>
            {data.notes.map((note, n) => (
              <p key={n} style={{ margin: 0 }}>
                {note}
              </p>
            ))}
          </div>
        </main>
        <footer>
          <span>Casevoya</span>
          <span>Dates in Eastern time</span>
        </footer>
      </div>
    </SheetScreen>
  );
}

/** SRC-12: the public support catalogue. Read only; support is derived from live official claims (#188) and live, sourced rule packs. */
export default function SupportedPage() {
  return (
    <Suspense fallback={<SheetScreen page="book" tone="public"><QuietSheet title="What Casevoya supports" copy="Loading…" /></SheetScreen>}>
      <Body />
    </Suspense>
  );
}
