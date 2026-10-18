import { describe, expect, it } from "vitest";
import {
  NOT_SET,
  brandingPage,
  firmFields,
  firmPage,
  jurisdictionValue,
  languagePage,
  officeAddress,
  officeDialogs,
  officesPage,
  planLabel,
  settingsHeader,
  settingsTab,
  timezoneSuggestions,
  type FirmRow,
  type OfficeRecord,
} from "@/modules/sheet/settings-firm-present";
import { firmDetailChanges, officeInput, timezoneName } from "@/modules/settings/firm-input";

const FIRM: FirmRow = {
  id: "00000000-0000-4000-8000-000000000001",
  legal_name: "Synthetic Legal Inc.",
  display_name: "Synthetic Firm",
  timezone: "America/Toronto",
  jurisdiction_codes: ["CA", "ON"],
  billing_contact_name: "Billing Person",
  billing_contact_email: "billing@example.test",
  privacy_contact_name: null,
  privacy_contact_email: null,
  continuity_contact_name: "Continuity Person",
  continuity_contact_email: null,
  succession_note: null,
  branding: {},
};

const OFFICES: OfficeRecord[] = [
  { id: "o2", label: "Vancouver", address_line: "2 Synthetic Ave", locality: "Vancouver", region: "BC", postal_code: null, country_code: "CA", timezone: "America/Vancouver", is_primary: false },
  { id: "o1", label: "Toronto", address_line: "1 Synthetic St", locality: "Toronto", region: "ON", postal_code: "M5V 1A1", country_code: "CA", timezone: null, is_primary: true },
];

describe("Settings > Firm, Offices, Branding, Language and time", () => {
  it("routes the default tab and the four ported tabs only", () => {
    expect(settingsTab(undefined)).toBe("general");
    expect(settingsTab("general")).toBe("general");
    expect(settingsTab("offices")).toBe("offices");
    expect(settingsTab("branding")).toBe("branding");
    expect(settingsTab("language")).toBe("language");
    for (const other of ["portal", "ai", "team", "billing", "security", "retention", "integrations", "notifications"]) expect(settingsTab(other)).toBeNull();
  });

  it("shows the firm's own details, with Not set where nothing is saved", () => {
    const page = firmPage(FIRM);
    expect(page.firmName).toBe("Synthetic Firm");
    expect(Object.fromEntries(page.rows.map((row) => [row.label, row.value]))).toEqual({
      "Legal name": "Synthetic Legal Inc.",
      "Display name": "Synthetic Firm",
      "Organisation ID": FIRM.id,
      Jurisdictions: { parts: ["Federal (IRCC)", "Ontario"] },
      "Billing contact": "Billing Person",
      "Privacy contact": NOT_SET,
      "Continuity contact": "Continuity Person",
    });
    const withPlan = firmPage({ ...FIRM, succession_note: "Plan kept in the binder." });
    expect(withPlan.rows.at(-1)?.value).toEqual({ parts: ["Continuity Person", "succession plan on file (ORG-06)"] });
    expect(firmPage({ ...FIRM, continuity_contact_name: null }).rows.at(-1)?.value).toBe(NOT_SET);
    expect(jurisdictionValue([])).toBe(NOT_SET);
    expect(jurisdictionValue(["QC"])).toBe("Québec");
    expect(firmFields(FIRM).map((field) => field.key)).toEqual([
      "legal_name",
      "display_name",
      "billing_contact_name",
      "billing_contact_email",
      "privacy_contact_name",
      "privacy_contact_email",
      "continuity_contact_name",
      "continuity_contact_email",
    ]);
  });

  it("puts the edit control only where the signed-in person may use it", () => {
    expect(settingsHeader("general", "Synthetic Firm", "Plan: Trial", true).act?.dialog).toBe("dlgFirm");
    expect(settingsHeader("general", "Synthetic Firm", null, false).act).toBeNull();
    expect(settingsHeader("offices", "Synthetic Firm", null, true).act?.dialog).toBe("dlgOffice");
    expect(settingsHeader("offices", "Synthetic Firm", null, false).act).toBeNull();
    expect(settingsHeader("branding", "Synthetic Firm", null, true).act).toBeNull();
    expect(settingsHeader("language", "Synthetic Firm", null, false).act?.dialog).toBe("dlgTz");
    expect(planLabel("trial")).toBe("Plan: Trial");
    expect(planLabel(null)).toBeNull();
  });

  it("lists offices main first, with the firm's timezone when an office has none, and no invented staff count", () => {
    const page = officesPage(OFFICES, "America/Toronto", true);
    expect(page.rows).toEqual([
      { id: "o1", label: "Toronto (main office)", address: "1 Synthetic St, Toronto, ON M5V 1A1", timezone: "America/Toronto", staff: "—" },
      { id: "o2", label: "Vancouver", address: "2 Synthetic Ave, Vancouver, BC", timezone: "America/Vancouver", staff: "—" },
    ]);
    expect(officesPage([], "America/Toronto", false)).toMatchObject({ rows: [], empty: "No offices saved yet.", canEdit: false });
    expect(officeAddress({ address_line: "9 Rue", locality: "Paris", region: null, postal_code: null, country_code: "FR" })).toBe("9 Rue, Paris, FR");
    expect(officeDialogs(OFFICES)[0]).toMatchObject({ id: "o1", primary: true, timezone: "" });
  });

  it("shows the saved logo and colour, or says none is set, and the real email header", () => {
    const empty = brandingPage({ firmName: "Synthetic Firm", branding: {}, logoUrl: null, owner: false });
    expect(empty.figures[0]).toMatchObject({ box: "brd-l", images: [], empty: "No logo yet" });
    expect(empty.colourTag).toBe("No firm colour set");
    expect(empty.replace).toBeNull();
    expect(empty.preview.kind).toBe("html");
    expect(empty.preview.kind === "html" ? empty.preview.html : "").toContain("Synthetic Firm");
    const saved = brandingPage({ firmName: "Synthetic Firm", branding: { accent: "#0a4b93" }, logoUrl: "https://storage.example.test/signed", owner: true });
    expect(saved.figures[0].images).toEqual([{ src: "https://storage.example.test/signed", alt: "Synthetic Firm logo", height: 36 }]);
    expect(saved.colourTag).toBe("Firm colour #0A4B93");
    expect(saved.replace).toEqual({ label: "Replace logo", dialog: "dlgBrand" });
    expect(JSON.stringify(saved)).not.toMatch(/Northline/);
  });

  it("lists each staff member's own language and timezone", () => {
    const page = languagePage(
      [
        { name: "Zed Staff", locale: "fr-CA", timezone: "America/Montreal" },
        { name: "Ann Staff", locale: "en-CA", timezone: null },
      ],
      "America/Toronto",
    );
    expect(page.rows).toEqual([
      { name: "Ann Staff", language: "English", timezone: "America/Toronto" },
      { name: "Zed Staff", language: "French", timezone: "America/Montreal" },
    ]);
    expect(languagePage([], "America/Toronto").empty).toBe("No active staff yet.");
  });

  it("checks dialog input before the database does", () => {
    expect(firmDetailChanges({ legal_name: " New Legal ", billing_contact_email: "A@Example.TEST", sample_mode: "false" })).toEqual({
      changes: { legal_name: "New Legal", billing_contact_email: "a@example.test" },
    });
    expect(firmDetailChanges({ display_name: "" })).toHaveProperty("error");
    expect(firmDetailChanges({ privacy_contact_email: "nope" })).toHaveProperty("error");
    expect(firmDetailChanges({ continuity_contact_name: "", continuity_contact_email: "" })).toEqual({ changes: { continuity_contact_name: "", continuity_contact_email: "" } });
    expect(firmDetailChanges({ continuity_contact_name: "", continuity_contact_email: "c@example.test" })).toHaveProperty("error");
    expect(firmDetailChanges({})).toHaveProperty("error");
    expect(timezoneName("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(timezoneName("../etc")).toBeNull();
    expect(officeInput({ label: "Toronto", addressLine: "1 St", locality: "Toronto", countryCode: "ca", timezone: "", primary: true })).toEqual({
      label: "Toronto",
      addressLine: "1 St",
      locality: "Toronto",
      region: "",
      postalCode: "",
      countryCode: "CA",
      timezone: null,
      primary: true,
    });
    expect(officeInput({ label: "", addressLine: "1 St", locality: "Toronto" })).toHaveProperty("error");
    expect(officeInput({ label: "T", addressLine: "1 St", locality: "Toronto", timezone: "bad zone" })).toHaveProperty("error");
    expect(timezoneSuggestions(["Europe/Paris"])[0]).toBe("Europe/Paris");
    expect(timezoneSuggestions([])).toContain("America/Toronto");
  });
});
