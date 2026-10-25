/**
 * AI vendor terms (PRD AI-06): what each AI vendor Casevoya actually calls says, in its own published
 * words, about data use, retention, processing region, subprocessors and deletion. Reviewed
 * configuration, not a database table: the vendors are fixed by Casevoya's code (the Vo agent calls
 * the Claude API; "Draft in French" calls Workers AI), the same for every firm, so the terms change
 * only when the code or a vendor's page changes, and every change is reviewed in a pull request.
 *
 * Casevoya has a signed agreement with each vendor (Francis, 2026-10-24). Its text is on file with
 * Casevoya and is not reproduced here; it takes precedence over the published terms, which stay
 * quoted for reference. "Casevoya's commitments" are Casevoya's own AI data-handling terms, each
 * written to an obligation in the CICC Code of Professional Conduct (SOR/2022-128, quoted from
 * Justice Laws with section, anchor and "current to" date) and each something Casevoya's code does.
 *
 * Rules for editing this file:
 * - Every `quote` is copied word for word from the page at `source.url` (the section is named, and
 *   the anchor is in the URL where the page has one), with the date the page shows (`pageDate`), the
 *   day it was retrieved and the SHA-256 of the page as fetched. Nothing is paraphrased or recalled.
 * - A value a vendor's public pages don't state stays an empty list: the panel then says "Not stated
 *   in the published terms".
 * - Any change to the content needs a new `version`, and the same version in a new migration that
 *   redefines `app.vo_vendor_terms_version()` (a test checks they match). The firm owner then
 *   acknowledges the new version before Vo can be turned on again.
 */

export type VendorSource = {
  /** The page's own title. */
  title: string;
  /** The page, with the section's anchor where the page has one. */
  url: string;
  /** The section the quote is from, as the page numbers or names it. */
  section: string;
  /** The date the page shows ("Effective", "Last updated", the article date), or null when it shows none. */
  pageDate: string | null;
  /** The day Casevoya retrieved the page (YYYY-MM-DD). */
  retrievedOn: string;
  /** SHA-256 of the page's HTML as fetched that day. */
  sha256: string;
};

export type VendorStatement = { quote: string; source: VendorSource };

export const VENDOR_FIELDS = ["dataUse", "retention", "region", "subprocessors", "deletion"] as const;
export type VendorField = (typeof VENDOR_FIELDS)[number];

export const VENDOR_FIELD_LABEL: Record<VendorField, string> = {
  dataUse: "Data use (training)",
  retention: "Retention",
  region: "Processing region",
  subprocessors: "Subprocessors",
  deletion: "Deletion",
};

export type VendorTerms = {
  key: "anthropic" | "cloudflare";
  vendor: string;
  service: string;
  /** What Casevoya sends to this vendor (from Casevoya's code, not the vendor's words). */
  usedFor: string;
  /** How Casevoya calls it (facts about Casevoya's own configuration). */
  setup: string[];
  fields: Record<VendorField, VendorStatement[]>;
  /** The full terms and DPA. */
  terms: { label: string; url: string }[];
  /**
   * The signed agreement between the vendor and Casevoya. Its text is on file with Casevoya and is
   * not reproduced here: only that it exists and its effective date. It takes precedence over the
   * vendor's published terms, which stay quoted for reference.
   */
  agreement: { title: string; effectiveOn: string; note: string } | null;
};

/** One of Casevoya's own AI data-handling terms, written to meet an obligation in the CICC Code. */
export type CasevoyaCommitment = {
  key: string;
  /** The Code's own words for the obligation, with its section, anchor and "current to" date. */
  obligation: { section: string; heading: string; quote: string; url: string };
  /** Casevoya's commitment, in plain language (each line is something Casevoya's code does). */
  commitment: string[];
};

export type CasevoyaCommitments = {
  /** How the section is marked until Francis approves it. */
  status: string;
  source: { title: string; url: string; currentTo: string; retrievedOn: string; sha256: string };
  items: CasevoyaCommitment[];
};

export type VoVendorTerms = {
  /** Bumped on any content change; must equal app.vo_vendor_terms_version(). */
  version: string;
  /** The day the content was last reviewed against the vendors' pages (YYYY-MM-DD). */
  reviewedOn: string;
  reviewedBy: string;
  vendors: VendorTerms[];
  commitments: CasevoyaCommitments;
};

/** Francis, 2026-10-24: "last week Tuesday", recorded as 2026-10-20 (to be confirmed by Francis). */
const AGREEMENT_EFFECTIVE = "2026-10-20";
const AGREEMENT_NOTE = "On file with Casevoya; available on request.";

const RETRIEVED = "2026-10-24";

const ANTHROPIC_COMMERCIAL_TERMS = "https://www.anthropic.com/legal/commercial-terms";
const ANTHROPIC_DPA = "https://www.anthropic.com/legal/data-processing-addendum";
const CLOUDFLARE_DPA = "https://www.cloudflare.com/cloudflare-customer-dpa/";
const CLOUDFLARE_DEV_TERMS = "https://www.cloudflare.com/service-specific-terms-developer-platform/";
const CICC_CODE = "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2022-128/FullText.html";

const A_TERMS = { title: "Commercial Terms of Service", pageDate: "Effective Jun 17, 2025", retrievedOn: RETRIEVED, sha256: "8c357108c3c6fed9676d4eb336478d2cb93b8a5f2eb6d34ad7b4f961bc2e38b6" };
const A_DPA = { title: "Data Processing Addendum", pageDate: "Effective Feb 24, 2025", retrievedOn: RETRIEVED, sha256: "4a8c123f79c35e8653a542a17b0ee1f5923164783fa8e7cca66c642477f258ab" };
const A_TRAINING = {
  title: "Is my data used for model training? (Anthropic Privacy Center, Commercial Customers)",
  pageDate: "August 18, 2026",
  retrievedOn: RETRIEVED,
  sha256: "02170c928e37d7c61af3af8550132fdcc0604367358364b1be42d388f9ce7ef6",
};
const A_RETENTION = {
  title: "How long do you store my organization’s data? (Anthropic Privacy Center, Commercial Customers)",
  pageDate: "July 1, 2026",
  retrievedOn: RETRIEVED,
  sha256: "9a237eff967baf6063407c405a54b4ee724d3b6afef103ec3bf41bb1e3ab9c8e",
};
const A_RESIDENCY = { title: "Data residency (Claude Platform Docs)", pageDate: null, retrievedOn: RETRIEVED, sha256: "cea6a628f7aca899c1459b8d4bae63766edb7d89e6f68c21734f68112f3ca0a2" };

const C_WORKERS_AI = { title: "Data usage (Cloudflare Workers AI docs)", pageDate: "Last updated Oct 16, 2026", retrievedOn: RETRIEVED, sha256: "b1611b59fe746ef3eba5e1c6c58a9e879af76dabd4e64c1f0d8c592516333c55" };
const C_DEV_TERMS = { title: "Service-Specific Terms: Developer Platform", pageDate: "Last updated: September 28, 2026", retrievedOn: RETRIEVED, sha256: "c0b73613e5054115b4e83320e01d6dfcc7bbc2fcbc0ef9effe1cddce79ce78e7" };
const C_DPA = { title: "Cloudflare Data Processing Addendum", pageDate: "Version 6.4, effective April 3, 2026", retrievedOn: RETRIEVED, sha256: "c568bfa02eef6d4e94e5ac628b7d7e03b1aa96fa68d058da84984504f094c280" };
const C_SUBPROCESSORS = { title: "Cloudflare Sub-Processors: For Cloudflare services", pageDate: "Last Updated: October 1, 2025", retrievedOn: RETRIEVED, sha256: "48aa50d377968b337992d3867358bd52a06215608ea4c655ff1700f96f490aa4" };

export const VO_VENDOR_TERMS: VoVendorTerms = {
  version: "2026-10-25.1",
  reviewedOn: "2026-10-25",
  reviewedBy: "Casevoya platform team",
  vendors: [
    {
      key: "anthropic",
      vendor: "Anthropic",
      service: "Claude API",
      usedFor:
        "Vo: reply drafts, staff answers, document readings, letter drafts, lead follow-up drafts and call-notes summaries. The records Vo reads for a run and its draft pass through the Claude API.",
      setup: ["Called by Casevoya’s Vo agent with Casevoya’s own API key.", "Vo doesn’t choose an inference geography, so Anthropic’s default applies."],
      agreement: { title: "Signed agreement between Anthropic and Casevoya", effectiveOn: AGREEMENT_EFFECTIVE, note: AGREEMENT_NOTE },
      fields: {
        dataUse: [
          { quote: "Anthropic may not train models on Customer Content from Services.", source: { ...A_TERMS, url: `${ANTHROPIC_COMMERCIAL_TERMS}#b-customer-content`, section: "B. Customer Content" } },
          {
            quote: "By default, we will not use your inputs or outputs from our commercial products (e.g. Claude for Work, Anthropic API, Claude Gov, etc.) to train our models.",
            source: { ...A_TRAINING, url: "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training", section: "Is my data used for model training?" },
          },
        ],
        retention: [
          {
            quote:
              "For Anthropic API users, we automatically delete inputs and outputs on our backend within 30 days of receipt or generation, except:\nWhen you use a service with longer retention under your control (e.g. Files API)\nWhen you and we have agreed otherwise (e.g. zero data retention agreement)\nIf we need to retain them for longer to enforce our Usage Policy (UP)\nIn compliance with the law",
            source: { ...A_RETENTION, url: "https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data#h_fb782701dc", section: "Standard Retention Timeframe" },
          },
          {
            quote:
              "We retain inputs and outputs for up to 2 years and trust and safety classification scores for up to 7 years if your chat is flagged by our automated trust and safety systems as violating our Usage Policy.",
            source: { ...A_RETENTION, url: "https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data#h_f745861b74", section: "Usage Policy Violations" },
          },
        ],
        region: [
          {
            quote: "\"global\" Default. Inference may run in any available geography for optimal performance and availability.",
            source: { ...A_RESIDENCY, url: "https://platform.claude.com/docs/en/manage-claude/data-residency#inference-geo", section: "Inference geo" },
          },
          {
            quote: "Workspace geo is set when you create a workspace and can't be changed afterward. Currently, \"us\" is the only available workspace geo.",
            source: { ...A_RESIDENCY, url: "https://platform.claude.com/docs/en/manage-claude/data-residency#workspace-geo", section: "Workspace geo" },
          },
        ],
        subprocessors: [
          {
            quote: "Customer grants Anthropic general authorization to engage the Subprocessors listed in Schedule 4, and any additional Subprocessors in accordance with Section C.3. below.",
            source: { ...A_DPA, url: `${ANTHROPIC_DPA}#c-subprocessors`, section: "C.1" },
          },
          {
            quote: "Anthropic’s list of subprocessors is available at https://www.anthropic.com/subprocessors.",
            source: { ...A_DPA, url: `${ANTHROPIC_DPA}#schedule-4---subprocessors`, section: "Schedule 4 - Subprocessors" },
          },
        ],
        deletion: [
          {
            quote:
              "Within thirty (30) days of the date of termination or expiration of the Agreement, Anthropic will: … delete all copies of Customer Data (including Customer Personal Data) processed by Anthropic or any Subprocessors, except to the extent (i) Applicable Data Protection Laws or other applicable legal or regulatory requirements requires storage of the Customer Data, (ii) retention of the Customer Data by Anthropic is necessary to resolve a dispute between the parties, or (iii) retention of the Customer Data is necessary to combat harmful use of the Services.",
            source: { ...A_DPA, url: `${ANTHROPIC_DPA}#h-deletion-and-return`, section: "H.1 and H.1.b" },
          },
        ],
      },
      terms: [
        { label: "Anthropic Commercial Terms of Service", url: ANTHROPIC_COMMERCIAL_TERMS },
        { label: "Anthropic Data Processing Addendum", url: ANTHROPIC_DPA },
      ],
    },
    {
      key: "cloudflare",
      vendor: "Cloudflare",
      service: "Workers AI",
      usedFor: "Draft in French: the English text a staff member asks to translate passes through Workers AI. Cloudflare also runs Casevoya and the Vo agent’s container.",
      setup: [
        "Called through the Casevoya app’s Workers AI binding, without AI Gateway, so no gateway logging or caching is turned on.",
        "Running Casevoya and the Vo agent’s container is covered by Cloudflare’s DPA and Developer Platform terms; the Workers AI page below covers the French drafts only.",
      ],
      agreement: { title: "Signed agreement between Cloudflare and Casevoya", effectiveOn: AGREEMENT_EFFECTIVE, note: AGREEMENT_NOTE },
      fields: {
        dataUse: [
          {
            quote: "No training: Cloudflare does not use Customer Content processed by Workers AI to train AI models.",
            source: { ...C_WORKERS_AI, url: "https://developers.cloudflare.com/workers-ai/platform/data-usage/#our-commitments-for-customer-content", section: "Our commitments for Customer Content" },
          },
          {
            quote: "Unless otherwise agreed, Cloudflare does not use any Customer Content to train generative AI tools.",
            source: { ...C_DEV_TERMS, url: `${CLOUDFLARE_DEV_TERMS}#developer-platform-cloudflare-workers-ai-ai-gateway`, section: "Cloudflare Workers AI; AI Gateway" },
          },
        ],
        retention: [
          {
            quote:
              "Zero data retention: Workers AI processes Customer Content only for as long as needed to provide the service. For standard inference requests that do not invoke a stateful feature, Cloudflare does not retain inputs or outputs after they are no longer needed to process the request and deliver the response, subject to the limited exceptions below.",
            source: { ...C_WORKERS_AI, url: "https://developers.cloudflare.com/workers-ai/platform/data-usage/#our-commitments-for-customer-content", section: "Our commitments for Customer Content" },
          },
          {
            quote:
              "Cloudflare may retain operational metadata needed to operate, secure, support, and bill for Workers AI. This may include account and model identifiers, timestamps, request and response sizes, token or neuron counts, latency, request source, and normalized status or error codes. Operational metadata retained under this section does not include Customer Content.",
            source: { ...C_WORKERS_AI, url: "https://developers.cloudflare.com/workers-ai/platform/data-usage/#operational-metadata", section: "Operational metadata" },
          },
        ],
        // Neither the Workers AI data usage page, the Developer Platform terms nor the DPA states
        // where Workers AI inference runs. The sub-processor list names Workers AI sub-processors
        // and their locations (below), which is not the same statement.
        region: [],
        subprocessors: [
          {
            quote: "CoreWeave, Inc. | Workers AI | United States; Nebius BV | Workers AI | England",
            source: { ...C_SUBPROCESSORS, url: "https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/", section: "Sub‑Processor, Activity, Location (the Workers AI rows)" },
          },
          {
            quote: "Cloudflare will maintain a list of sub-Processors at https://www.cloudflare.com/gdpr/subprocessors/ and will add the names of new and replacement sub-Processors to the list at least thirty (30) days prior to the date on which those sub-Processors commence processing of Personal Data.",
            source: { ...C_DPA, url: `${CLOUDFLARE_DPA}#sub-processing`, section: "4.4" },
          },
        ],
        deletion: [
          {
            quote:
              "other than to the extent required to comply with applicable law, following termination or expiry of the Main Agreement or completion of the Service, at the choice of Customer, delete or return all Personal Data (including copies thereof) processed pursuant to this DPA;",
            source: { ...C_DPA, url: CLOUDFLARE_DPA, section: "3.1 i)" },
          },
        ],
      },
      terms: [
        { label: "Cloudflare Data Processing Addendum", url: CLOUDFLARE_DPA },
        { label: "Cloudflare Developer Platform terms", url: CLOUDFLARE_DEV_TERMS },
      ],
    },
  ],
  commitments: {
    status: "Casevoya’s terms, written to the CICC Code; pending Francis’s approval",
    source: {
      title: "Code of Professional Conduct for College of Immigration and Citizenship Consultants Licensees (SOR/2022-128)",
      url: CICC_CODE,
      currentTo: "2026-09-30",
      retrievedOn: "2026-10-25",
      sha256: "de8ea36fdeacc7fbb13978c6d0d1426378466a259c2473a793e95daa21c43f8a",
    },
    items: [
      {
        key: "confidentiality",
        obligation: {
          section: "28(1)",
          heading: "Obligation of confidentiality",
          quote:
            "A licensee must keep confidential all information in relation to a client or former client, or a client’s or former client’s business affairs, that was acquired in the course of their professional relationship with that client and take the measures that are necessary to maintain the confidentiality of that information indefinitely.",
          url: `${CICC_CODE}#s-28`,
        },
        commitment: [
          "Casevoya doesn’t use your clients’ information to train any AI model.",
          "Vo reads a record only with the access of the staff member who asked, under the firm’s own permissions; it can’t read another firm’s records.",
          "Identity numbers are removed from the records Vo reads for reply drafts, answers and letters before they reach the AI vendor.",
          "Vo’s run log keeps who asked, the model, the prompt version and how many records were read, never the prompt or the client’s text. Vo’s “useful?” vote stays in Casevoya and isn’t sent to the vendor.",
        ],
      },
      {
        key: "minimum",
        obligation: {
          section: "28(3)",
          heading: "Scope of disclosure",
          quote: "If a licensee discloses confidential information under subsection (2), the licensee must not disclose more information than necessary to respond to the specific basis for the disclosure.",
          url: `${CICC_CODE}#1354676`,
        },
        commitment: [
          "Vo sends the AI vendor only what one task needs: the matter, conversation, lead, document or notes the staff member is working on, not the firm’s records at large.",
          "Identity, relationship, financial, medical, criminal-history and narrative documents stay away from Vo until the firm owner switches each kind on; notes that mention medical or criminal details are kept from Vo the same way.",
          "With Vo off for the firm, nothing is sent to the AI vendor for Vo.",
        ],
      },
      {
        key: "agreement",
        obligation: {
          section: "24(3)(q)",
          heading: "Service agreement",
          quote:
            "The service agreement must include the following information: … a statement that the licensee has an obligation of confidentiality under this Code and a description of the manner in which the licensee will maintain the confidentiality of the client’s information and documents;",
          url: `${CICC_CODE}#1354626`,
        },
        commitment: [
          "This page says, in plain words, which AI vendors receive client information when Vo is used, for what, and on which terms, so the firm can describe it in its service agreements.",
          "When these terms change, Casevoya publishes a new version and the firm owner acknowledges it before Vo can be turned on again.",
        ],
      },
      {
        key: "supervision",
        obligation: {
          section: "38(2)",
          heading: "Professional responsibility",
          quote:
            "A licensee must supervise and assume professional responsibility for any work done by a person who assists in the provision of immigration or citizenship consulting services and ensure that the level of supervision is adequate for the type of work in question.",
          url: `${CICC_CODE}#1354762`,
        },
        commitment: [
          "Vo only drafts. Nothing Vo writes is sent, signed, submitted or recorded until a person accepts it.",
          "A letter Vo drafts can be released only after a licensed member approves that exact version.",
          "Vo doesn’t give advice or quote a rule, fee or deadline without a source the firm approved: it leaves it for a consultant and says so.",
        ],
      },
      {
        key: "technology",
        obligation: {
          section: "19(2)(e)",
          heading: "Nature of competence",
          quote: "To fulfill their professional obligations competently, a licensee must … be able to deliver the services to the client using technology that is appropriate and effective",
          url: `${CICC_CODE}#1354546`,
        },
        commitment: [
          "The firm owner can turn Vo off for the whole firm, for one capability or for a sensitive kind of document, and every workflow still works by hand.",
          "If Vo is unavailable, staff draft by hand and nothing else stops.",
        ],
      },
      {
        key: "records",
        obligation: {
          section: "37",
          heading: "Record keeping",
          quote:
            "A licensee must maintain a reliable system of office administration in relation to the immigration or citizenship consulting services that they provide and keep and preserve records in accordance with the by-laws made under the Act.",
          url: `${CICC_CODE}#s-37`,
        },
        commitment: [
          "Every Vo run is recorded with who asked, the model, the prompt version, the records it read and who reviewed the result (Vo and AI › Run log).",
          "Every draft keeps what happened to it and who decided (Draft audit); turning Vo on or off and acknowledging these terms are in the firm’s audit trail.",
        ],
      },
    ],
  },
};

/** The vendors' fields a public page doesn't state, as "Vendor: Field" (for the report and the panel). */
export function unstatedFields(terms: VoVendorTerms = VO_VENDOR_TERMS): string[] {
  return terms.vendors.flatMap((vendor) => VENDOR_FIELDS.filter((field) => vendor.fields[field].length === 0).map((field) => `${vendor.vendor}: ${VENDOR_FIELD_LABEL[field]}`));
}
