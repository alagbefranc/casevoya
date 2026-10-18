# Client account (client funds) — official sources

What the Finance → Client funds ledger is built against, and what it deliberately does not encode.
Casevoya never holds client money: the ledger records what happens in the firm's own client
account at its own bank.

## Sources

| Source | URL | Retrieved |
|---|---|---|
| Code of Professional Conduct for College of Immigration and Citizenship Consultants Licensees, SOR/2022-128 (Justice Laws, "current to 2026-09-30") | https://laws-lois.justice.gc.ca/eng/regulations/sor-2022-128/FullText.html | 2026-10-18 (re-read 2026-10-18 for receipts, the 30-day withdrawal and the bank transfer step) |

## What the Code says (s. 32, 33, 36, 37, 39), and how the ledger maps to it

Quoted in fragments from the page above; read the Code itself for the full text.

| Provision | Text (fragment) | In the ledger |
|---|---|---|
| s. 32(a) | "hold the funds in trust in a client account, opened by the licensee, … at a financial institution that is approved by the College" | The firm records its client account (label, institution, last 4 digits). Casevoya does **not** check that the institution is College-approved: open question. |
| s. 32(b) | "on receipt of an advance payment, provide the client with a receipt that clearly indicates the amount of the advance payment and deposit the funds into the client account" | Verifying a deposit issues a receipt (`client_fund_receipts`, `RC-0001` per firm, append-only): amount, date received, client, matter, method, reference, the client account (institution and last 4), firm, and the matter's responsible consultant with their CICC licence when one is on file. The PDF is rendered by the app (pdf-lib) at `/api/client-funds/receipts/<entry>`; billing staff and the client download it. The Code asks only that the receipt "clearly indicates the amount"; the other fields are product choices. |
| s. 32(c) | "refrain from depositing any funds not belonging to a client into the client account" | The Record-a-payment dialog only offers client accounts and every deposit names a client and matter. Not otherwise enforceable in software. |
| s. 32(d) | "maintain separate records of deposits and withdrawals for each client" | One sub-ledger per client (person) per matter per client account. Entries are append-only. |
| s. 32(e) | "use the funds held in the client account only for the purpose for which they were paid" | A transfer out pays only an issued invoice on the **same matter**, and never more than that client's available balance. |
| s. 32(f) | "before withdrawing funds from the client account, invoice the client in accordance with subsection 33(1)" | A transfer to operating must reference an issued (earned) invoice. A recorded bank transfer can't be dated before that invoice's issue date. |
| s. 32(g) | "not later than 30 days after the day on which the client is invoiced under paragraph (f), withdraw the invoiced amount from the client account" | **Shown, not enforced.** Withdraw-by = the invoice's `issued_on` + 30 days (`app.client_funds_withdraw_by`); day 30 is the last day, day 31 is overdue. `list_client_fund_withdrawals()` lists, for billing staff, transfers waiting for approval, approved transfers whose bank transfer isn't recorded, and issued invoices on a matter where the firm holds client money and no transfer was asked for (the smaller of the amount due and the money held). The Client funds tab shows a "Withdraw by" tile and a badge per client ledger; the home page's "financial exceptions" counts overdue ones. A withdrawal is complete when the bank transfer is recorded. Nothing is blocked after the date and no email is sent. |
| s. 33(3) | "When a payment is received from a client, the licensee must provide the client with a receipt that clearly indicates the invoice to which the payment relates." | Not built for card or client-funds payments of invoices. Out of scope for this change (it concerns payments of invoices, not advances). |
| s. 33(1) | "may invoice a client only once they have provided … services … or have made disbursements" | Already how invoices work (delivered work or incurred cost is required). |
| s. 36(1)(b),(d) | "provide an accounting of all funds received" / "refund to the client any funds held in trust … in excess of the invoiced amount" | Refund-to-client entries exist; an end-of-engagement accounting report is **not built**. |
| s. 37 | "keep and preserve records in accordance with the by-laws" | No retention period is encoded here; the by-laws were not reviewed for this change. |
| s. 39(f) | report "an error … with respect to the use or attribution of funds held in trust in a client account" to the Registrar within 30 days | Corrections are reversing entries with a reason, audited. Casevoya does not report to the Registrar or prompt to. Open question. |

## Not encoded (deliberately)

* Which banks are approved, account-type requirements, interest handling.
* Retention periods, reconciliation frequency, sign-off requirements for reconciliation.
* The 30-day withdrawal window (s. 32(g)) as a hard rule: it is computed and shown, never blocking.
* Whether "on receipt" in s. 32(b) means when the money arrives or when the firm confirms it on the
  statement: Casevoya issues the receipt when a second person verifies the deposit. Open question.
* Second-person verification of deposits is a product control, like maker-checker on transfers;
  the Code does not require it. The firm owner may verify their own entry (Francis).
* Two-person approval as a regulatory requirement: it is a product control (maker-checker), with the
  owner-as-sole-approver exception decided by Francis (see `docs/DECISIONS.md`).
