/**
 * #272 item 1: a sponsor opening a co-applicant's document request on the portal sees the
 * co-applicant's initials and name in step 2 ("Whose document is it?"), never "P / Person".
 * Persons RLS hides the co-applicant's row (viewer.people has only the sponsor), so the loader
 * takes the name from public.portal_request_person_names.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortalViewer } from "@/modules/portal/load";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

const ORG = "00000000-0000-4000-8000-000000000001";
const MATTER = "00000000-0000-4000-8000-000000000002";
const INGRID = "00000000-0000-4000-8000-000000000003";
const ELIAS = "00000000-0000-4000-8000-000000000004";
const REQUEST = "00000000-0000-4000-8000-000000000005";

const tables: Record<string, unknown[]> = {
  document_requests: [
    {
      id: REQUEST,
      matter_id: MATTER,
      person_id: ELIAS,
      document_id: null,
      purpose: "Passport bio page",
      explanation: "",
      acceptable_formats: ["pdf"],
      status: "open",
      audience: "matter",
      sensitivity: "ordinary",
      version: 1,
      expires_on: null,
    },
  ],
};
const rpcs: Record<string, unknown> = {
  document_request_progress: null,
  document_upload_limit: 25 * 1024 * 1024,
  portal_request_person_names: [{ person_id: ELIAS, display_name: "Elias Lindqvist" }],
};

/** Just enough of the Supabase query builder for loadPortalDocuments. */
function query(rows: unknown[]) {
  const result = { data: rows, error: null };
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "neq", "order", "limit", "is", "eq"]) chain[name] = () => chain;
  chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => query(tables[table] ?? []),
    rpc: async (name: string) => ({ data: rpcs[name] ?? null, error: null }),
  }),
}));

const viewer: PortalViewer = {
  organizationId: ORG,
  organizationName: "Maple 260",
  organizationSlug: "maple-260",
  timezone: "America/Toronto",
  role: "sponsor",
  person: { id: INGRID, displayName: "Ingrid Sample", email: null, phone: null, isMinor: false, role: "sponsor" },
  matters: [{ id: MATTER, title: "Spousal sponsorship", stage: "evidence collection", onHold: false, reference: "CA-2026-0004" }],
  // RLS: the sponsor reads only her own person row.
  people: [{ id: INGRID, displayName: "Ingrid Sample", email: null, phone: null, isMinor: false, role: "sponsor" }],
  grants: [],
  shares: [],
  prefs: null,
  sections: [],
};

describe("portal upload for a co-applicant (#272)", () => {
  it("names the co-applicant on the request and in step 2's avatar, never Person", async () => {
    const { loadPortalDocuments } = await import("@/modules/documents/load");
    const { DocumentsLive } = await import("@/components/portal/documents-live");
    const documents = await loadPortalDocuments(viewer);
    expect(documents.requests.map((item) => item.personName)).toEqual(["Elias Lindqvist"]);
    expect(documents.cards.map((card) => card.personName)).toEqual(["Elias Lindqvist"]);

    const html = renderToStaticMarkup(createElement(DocumentsLive, { page: "upload", viewer, documents }));
    const step = html.slice(html.indexOf('id="up-s1"'), html.indexOf('id="up-s2"'));
    expect(step).toContain('<span class="av" aria-hidden="true">EL</span>');
    expect(step).toContain("<b style=\"font-weight:500\">Elias Lindqvist</b>");
    expect(step).toContain("Shared on the matter. People on it can see it.");
    expect(html).not.toMatch(/>Person</);
    expect(html).not.toContain('<span class="av" aria-hidden="true">P</span>');
  });

  it("keeps names the viewer can read and adds only missing ones", async () => {
    const { portalPersonNames } = await import("@/modules/documents/load");
    const names = portalPersonNames(
      [{ id: INGRID, displayName: "Ingrid Sample" }],
      [{ person_id: INGRID, display_name: "Other" }, { person_id: ELIAS, display_name: "Elias Lindqvist" }],
    );
    expect(Object.fromEntries(names)).toEqual({ [INGRID]: "Ingrid Sample", [ELIAS]: "Elias Lindqvist" });
    // The read missing (migration not applied yet, or an error): the loader falls back as before.
    expect(Object.fromEntries(portalPersonNames([{ id: INGRID, displayName: "Ingrid Sample" }], null))).toEqual({ [INGRID]: "Ingrid Sample" });
  });
});
