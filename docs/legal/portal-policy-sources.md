# Client portal terms and privacy notice: sources

The starting drafts in `src/modules/portal-policies/defaults.ts` (`defaultPortalTerms`,
`defaultPrivacyNotice`) are plain-language templates for a Canadian immigration consultancy
(RCIC) client portal. They are **not legal advice**. Each firm reviews, edits and publishes its
own text in Settings > Client portal (`/sheet/settings?tab=portal`). The publish check refuses
text that still contains a `[Add …]` blank, so a firm must at least state where its providers
store client data and how long it keeps closed files.

All sources are official pages of the Office of the Privacy Commissioner of Canada (OPC).
Retrieved 2026-10-18.

| Source | URL | Used for |
| --- | --- | --- |
| PIPEDA fair information principles | https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/ | The notice's structure: accountability (named privacy officer), identifying purposes, consent, limiting collection, limiting use/disclosure/retention, accuracy, safeguards, openness, individual access, challenging compliance. |
| Guidelines for obtaining meaningful consent | https://www.priv.gc.ca/en/privacy-topics/collecting-personal-information/consent/gl_omc_201805/ | Emphasising what is collected, who it is shared with, why, and the risks; separating essential from optional uses (text reminders) with a real choice; withdrawal of consent; asking again before significant changes. |
| PIPEDA requirements in brief | https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/ | Which law applies (PIPEDA, and substantially similar provincial laws in Alberta, British Columbia and Quebec), and that individuals can complain to the OPC. |
| Guidelines for processing personal data across borders | https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/ | Telling clients that service providers may process information outside Canada, where it may be accessible to that country's courts, law enforcement and national security authorities; the firm stays accountable for its providers. |
| Guidance on assessing third-party service providers | https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/gd_third-party_202609/ | Naming the kinds of service providers (portal software, email, e-signature, hosting) and the limits on their use of the information. |
| What you need to know about mandatory reporting of breaches of security safeguards | https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/privacy-breaches-at-your-business/gd_pb_201810/ | The safeguards section's breach promise: notify affected individuals and report to the OPC when a breach creates a real risk of significant harm. |

## Points the firm must check before publishing

- **Where data is stored.** The draft leaves a blank; fill it from the firm's own provider contracts.
- **Retention period.** The draft leaves a blank with an example of at least six years after the
  file closes. Confirm against the firm's obligations to the College of Immigration and
  Citizenship Consultants and any other law that applies.
- **Response time for access requests.** The draft says 30 days, PIPEDA's general time limit for
  answering an access request (Schedule 1 principle 4.9 and section 8(3)). Firms under a provincial
  law should check its limit.
- **OPC contact.** The draft gives www.priv.gc.ca and the OPC's toll-free number, 1-800-282-1376.
  Confirm it on priv.gc.ca before publishing.
- **Retainer agreement.** The terms say the retainer agreement prevails if the two conflict.
  Confirm that matches the firm's retainer.
