/**
 * Official text captured for privacy-request time limits (SEC-06), offered as a starting point in
 * the "Add legal time limit" dialog. Nothing here is used as a rule: staff enter it as a firm entry,
 * Casevoya fetches the page again on the server and stores its hash, and it applies only after a
 * licensed member of the firm approves it. Copied word for word from Justice Laws.
 *
 * Captured from https://laws-lois.justice.gc.ca/eng/acts/P-8.6/FullText.html
 *   retrieved 2026-10-24 23:50:50 UTC (HTTP 200), SHA-256 of the page
 *   4088c73bea999c93a2c713aa23e7d1827e0647713a551c4d72677ae8832d67b7;
 *   the page states "Act current to 2026-09-30 and last amended on 2025-03-04".
 * Whether PIPEDA governs a given firm (or a provincial law instead) is the firm's own decision.
 */

export type CapturedProvision = {
  key: string;
  label: string;
  kind: "response" | "extension";
  lawName: string;
  section: string;
  sourceUrl: string;
  provisionText: string;
  /** Only when the provision states a number of days. */
  days: number | null;
  /** The page's "current to" date (YYYY-MM-DD). */
  currentTo: string;
  retrievedOn: string;
  pageSha256: string;
};

const PIPEDA = "Personal Information Protection and Electronic Documents Act (S.C. 2000, c. 5)";
const PIPEDA_URL = "https://laws-lois.justice.gc.ca/eng/acts/P-8.6/FullText.html#s-8";
const CURRENT_TO = "2026-09-30";
const RETRIEVED_ON = "2026-10-24";
const PAGE_SHA256 = "4088c73bea999c93a2c713aa23e7d1827e0647713a551c4d72677ae8832d67b7";

export const CAPTURED_PROVISIONS: CapturedProvision[] = [
  {
    key: "pipeda-8-3",
    label: "PIPEDA s. 8(3), Time limit",
    kind: "response",
    lawName: PIPEDA,
    section: "s. 8(3)",
    sourceUrl: PIPEDA_URL,
    provisionText:
      "An organization shall respond to a request with due diligence and in any case not later than thirty days after receipt of the request.",
    days: 30,
    currentTo: CURRENT_TO,
    retrievedOn: RETRIEVED_ON,
    pageSha256: PAGE_SHA256,
  },
  {
    key: "pipeda-8-4-a",
    label: "PIPEDA s. 8(4)(a), Extension of time limit",
    kind: "extension",
    lawName: PIPEDA,
    section: "s. 8(4)(a)",
    sourceUrl: PIPEDA_URL,
    provisionText:
      "An organization may extend the time limit (a) for a maximum of thirty days if (i) meeting the time limit would unreasonably interfere with the activities of the organization, or (ii) the time required to undertake any consultations necessary to respond to the request would make the time limit impracticable to meet; … In either case, the organization shall, no later than thirty days after the date of the request, send a notice of extension to the individual, advising them of the new time limit, the reasons for extending the time limit and of their right to make a complaint to the Commissioner in respect of the extension.",
    days: 30,
    currentTo: CURRENT_TO,
    retrievedOn: RETRIEVED_ON,
    pageSha256: PAGE_SHA256,
  },
  {
    key: "pipeda-8-4-b",
    label: "PIPEDA s. 8(4)(b), Extension for an alternative format",
    kind: "extension",
    lawName: PIPEDA,
    section: "s. 8(4)(b)",
    sourceUrl: PIPEDA_URL,
    provisionText:
      "An organization may extend the time limit … (b) for the period that is necessary in order to be able to convert the personal information into an alternative format. In either case, the organization shall, no later than thirty days after the date of the request, send a notice of extension to the individual, advising them of the new time limit, the reasons for extending the time limit and of their right to make a complaint to the Commissioner in respect of the extension.",
    days: null,
    currentTo: CURRENT_TO,
    retrievedOn: RETRIEVED_ON,
    pageSha256: PAGE_SHA256,
  },
];
