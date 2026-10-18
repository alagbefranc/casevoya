# Client account (client funds) — official sources

What the Finance → Client funds ledger is built against, and what it deliberately does not encode.
Casevoya never holds client money: the ledger records what happens in the firm's own client
account at its own bank.

## Sources

| Source | URL | Retrieved |
|---|---|---|
| Code of Professional Conduct for College of Immigration and Citizenship Consultants Licensees, SOR/2022-128 (Justice Laws, "current to 2026-09-30") | https://laws-lois.justice.gc.ca/eng/regulations/sor-2022-128/FullText.html | 2026-10-18 |

## What the Code says (s. 32, 33, 36, 37, 39), and how the ledger maps to it

Quoted in fragments from the page above; read the Code itself for the full text.

| Provision | Text (fragment) | In the ledger |
|---|---|---|
| s. 32(a) | "hold the funds in trust in a client account, opened by the licensee, … at a financial institution that is approved by the College" | The firm records its client account (label, institution, last 4 digits). Casevoya does **not** check that the institution is College-approved: open question. |
| s. 32(b) | "on receipt of an advance payment, provide the client with a receipt … and deposit the funds into the client account" | Deposits are recorded against a client account. **Receipts are not generated yet**: open question / follow-up. |
| s. 32(c) | "refrain from depositing any funds not belonging to a client into the client account" | The Record-a-payment dialog only offers client accounts and every deposit names a client and matter. Not otherwise enforceable in software. |
| s. 32(d) | "maintain separate records of deposits and withdrawals for each client" | One sub-ledger per client (person) per matter per client account. Entries are append-only. |
| s. 32(e) | "use the funds held in the client account only for the purpose for which they were paid" | A transfer out pays only an issued invoice on the **same matter**, and never more than that client's available balance. |
| s. 32(f) | "before withdrawing funds from the client account, invoice the client in accordance with subsection 33(1)" | A transfer to operating must reference an issued (earned) invoice. |
| s. 32(g) | "not later than 30 days after the day on which the client is invoiced … withdraw the invoiced amount" | **Not enforced or alerted.** Listed as an open question (no reminder, no hard rule). |
| s. 33(1) | "may invoice a client only once they have provided … services … or have made disbursements" | Already how invoices work (delivered work or incurred cost is required). |
| s. 36(1)(b),(d) | "provide an accounting of all funds received" / "refund to the client any funds held in trust … in excess of the invoiced amount" | Refund-to-client entries exist; an end-of-engagement accounting report is **not built**. |
| s. 37 | "keep and preserve records in accordance with the by-laws" | No retention period is encoded here; the by-laws were not reviewed for this change. |
| s. 39(f) | report "an error … with respect to the use or attribution of funds held in trust in a client account" to the Registrar within 30 days | Corrections are reversing entries with a reason, audited. Casevoya does not report to the Registrar or prompt to. Open question. |

## Not encoded (deliberately)

* Which banks are approved, account-type requirements, interest handling.
* Retention periods, reconciliation frequency, sign-off requirements for reconciliation.
* The 30-day withdrawal window (s. 32(g)) as a hard rule.
* Two-person approval as a regulatory requirement: it is a product control (maker-checker), with the
  owner-as-sole-approver exception decided by Francis (see `docs/DECISIONS.md`).
