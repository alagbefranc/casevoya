"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import { correctOpeningBalance, reviewOpeningBalance } from "@/modules/finance/opening-balance-actions";
import { parseAmount } from "@/modules/finance/money";
import { formatMoney } from "@/modules/finance/money";
import {
  groupOpeningBalances,
  isLocked,
  kindLabel,
  mismatchesSource,
  statusLabel,
  type OpeningBalanceKind,
  type OpeningBalanceRow,
} from "@/modules/sheet/opening-balance-present";
import { Badge } from "./designer/matters";
import { Empty } from "./designer/frame";

/**
 * MIG-03: Finance › Opening balances. Live only. Lists imported balances by client and matter,
 * with the source-file totals. Approve, correct (with a reason) or reject. An approved or
 * rejected balance is locked. Nothing is posted to an invoice or a client account.
 */
export function OpeningBalancesPanel({
  organizationId,
  rows,
  failed = false,
}: {
  organizationId: string;
  rows: OpeningBalanceRow[];
  failed?: boolean;
}) {
  const router = useRouter();
  const files = groupOpeningBalances(rows);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<OpeningBalanceRow | null>(null);
  const [mode, setMode] = useState<"approve" | "reject" | "correct">("approve");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<OpeningBalanceKind>("receivable");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [asOf, setAsOf] = useState("");
  const [description, setDescription] = useState("");

  function open(row: OpeningBalanceRow, next: "approve" | "reject" | "correct") {
    setTarget(row);
    setMode(next);
    setReason("");
    setCode("");
    setKind(row.kind);
    setAmount((row.amountCents / 100).toFixed(2));
    setCurrency(row.currency);
    setAsOf(row.asOf);
    setDescription(row.description ?? "");
    const dialog = document.getElementById("dlgOb") as HTMLDialogElement | null;
    dialog?.showModal();
  }

  async function submit() {
    if (!target || busy) return;
    if (!/^\d{6}$/.test(code.trim())) {
      toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "Nothing was saved." });
      return;
    }
    setBusy(true);
    const result =
      mode === "correct"
        ? await correctOpeningBalance({
            organizationId,
            id: target.id,
            expectedVersion: target.version,
            kind,
            amountCents: parseAmount(amount, currency) ?? 0,
            currency,
            asOf,
            description,
            reason,
            code: code.trim(),
          })
        : await reviewOpeningBalance({
            organizationId,
            id: target.id,
            approve: mode === "approve",
            note: reason,
            code: code.trim(),
          });
    setBusy(false);
    if ("error" in result) {
      toast2(result.error, { kind: "bad" });
      return;
    }
    (document.getElementById("dlgOb") as HTMLDialogElement | null)?.close();
    toast2(mode === "approve" ? "Opening balance approved" : mode === "reject" ? "Opening balance rejected" : "Opening balance corrected", {
      kind: "ok",
      sub: mode === "correct" ? "The source file amount is unchanged." : "Nothing was posted to an invoice or a client account.",
    });
    router.refresh();
  }

  if (failed) {
    return (
      <div className={"panel rv"}>
        <Empty art={"templates-empty"} title={"Opening balances couldn’t load"} copy={"Reload the page. Nothing was changed. If it keeps happening, sign in again."} />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className={"panel rv"}>
        <Empty
          art={"templates-empty"}
          title={"No opening balances to review"}
          copy={"Imported opening balances appear here, one row per client and matter, after a financial opening-balances file is imported. Nothing is posted to an invoice or a client account."}
        />
      </div>
    );
  }

  return (
    <>
      <div className={"ph rv"}>
        <div>
          <h1 className={"display"}>{"Opening balances"}</h1>
          <p>
            {"Each row is an amount carried over from another system, as of a date. Compare it with the source file, then approve, correct or reject it. Approving locks the row and posts nothing to an invoice or a client account."}
          </p>
        </div>
      </div>
      {files.map((file) => (
        <section key={file.batchId} className={"panel rv"} aria-labelledby={`ob-${file.batchId}`}>
          <h2 id={`ob-${file.batchId}`}>{file.fileName}</h2>
          <p className={"fp-note"}>
            {"Checksum "}
            <span className={"num"} title={file.fileSha256}>{file.fileSha256.slice(0, 12)}</span>
            {`. The file had ${file.fileRowCount} ${file.fileRowCount === 1 ? "row" : "rows"}. ${file.importedCount} ${file.importedCount === 1 ? "balance was" : "balances were"} imported.`}
            {file.countMismatch ? " The counts don’t match, so part of the file was not imported." : ""}
          </p>
          <table className={"t"}>
            <caption className={"vh"}>{"Totals against the source file"}</caption>
            <thead>
              <tr>
                <th scope={"col"}>{"Kind"}</th>
                <th scope={"col"}>{"Source file"}</th>
                <th scope={"col"}>{"After review"}</th>
                <th scope={"col"}>{"Match"}</th>
              </tr>
            </thead>
            <tbody>
              {file.totals.map((total) => (
                <tr key={`${total.currency}-${total.kind}`}>
                  <td>{`${kindLabel(total.kind)} · ${total.currency}`}</td>
                  <td className={"num"}>{formatMoney(total.sourceCents, total.currency)}</td>
                  <td className={"num"}>{formatMoney(total.currentCents, total.currency)}</td>
                  <td>
                    <Badge badge={total.mismatch ? { tone: "chg", label: "Doesn’t match" } : { tone: "ok", label: "Matches" }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {file.groups.map((group) => (
            <div key={group.matterId}>
              <h3>
                {group.clientName}
                <span className={"sep"} aria-hidden={"true"} />
                {group.matterTitle}
              </h3>
              <table className={"t"}>
                <caption className={"vh"}>{`Opening balances for ${group.clientName}`}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Kind"}</th>
                    <th scope={"col"}>{"As of"}</th>
                    <th scope={"col"}>{"Source file"}</th>
                    <th scope={"col"}>{"Current"}</th>
                    <th scope={"col"}>{"Status"}</th>
                    <th scope={"col"}>{"Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const mismatch = mismatchesSource(row);
                    const locked = isLocked(row);
                    return (
                      <tr key={row.id}>
                        <td>
                          {kindLabel(row.kind)}
                          {row.description ? <small>{row.description}</small> : null}
                        </td>
                        <td className={"num"}>{row.asOf}</td>
                        <td className={"num"}>{formatMoney(row.sourceAmountCents, row.sourceCurrency)}</td>
                        <td className={"num"}>{formatMoney(row.amountCents, row.currency)}</td>
                        <td>
                          <Badge
                            badge={
                              row.status === "approved"
                                ? { tone: "ok", label: "Approved", detail: "Locked" }
                                : row.status === "rejected"
                                  ? { tone: "bad", label: "Rejected" }
                                  : mismatch
                                    ? { tone: "chg", label: "Awaiting review", detail: "Doesn’t match the file" }
                                    : { tone: "blue", label: statusLabel(row.status) }
                            }
                          />
                          <small>{`Imported from ${row.sourceSystem}.`}</small>
                          {row.reviewNote ? <small>{row.reviewNote}</small> : null}
                          {row.corrections.length ? (
                            <details>
                              <summary>{`${row.corrections.length} correction${row.corrections.length === 1 ? "" : "s"}`}</summary>
                              <ul>
                                {row.corrections.map((correction, index) => (
                                  <li key={`${row.id}-${index}`}>
                                    {correction.reason}
                                    {` (${formatMoney(correction.beforeAmountCents, row.sourceCurrency)} → ${formatMoney(correction.afterAmountCents, row.currency)})`}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ) : null}
                        </td>
                        <td>
                          {locked ? (
                            <span>{"Locked"}</span>
                          ) : (
                            <span className={"acts"}>
                              <button type={"button"} className={"btn p sm"} onClick={() => open(row, "approve")}>{"Approve"}</button>
                              <button type={"button"} className={"btn sm"} onClick={() => open(row, "correct")}>{"Correct"}</button>
                              <button type={"button"} className={"btn sm"} onClick={() => open(row, "reject")}>{"Reject"}</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}
      <dialog className={"dlg"} id={"dlgOb"} aria-labelledby={"dlgObH"}>
        <h2 id={"dlgObH"}>{mode === "approve" ? "Approve this opening balance" : mode === "reject" ? "Reject this opening balance" : "Correct this opening balance"}</h2>
        {mode === "approve" ? (
          <p>{"Approval records your review and locks the row. Nothing is posted to an invoice or a client account."}</p>
        ) : (
          <div className={"fld"}>
            <label htmlFor={"obReason"}>{"Reason"}</label>
            <textarea className={"ta"} id={"obReason"} value={reason} onChange={(event) => setReason(event.target.value)} required />
          </div>
        )}
        {mode === "correct" && target ? (
          <div className={"g2"}>
            <div className={"fld"}>
              <label htmlFor={"obKind"}>{"Kind"}</label>
              <select className={"sel"} id={"obKind"} value={kind} onChange={(event) => setKind(event.target.value as OpeningBalanceKind)}>
                <option value={"receivable"}>{"Receivable"}</option>
                <option value={"advance"}>{"Advance"}</option>
              </select>
            </div>
            <div className={"fld"}>
              <label htmlFor={"obAmt"}>{"Amount"}</label>
              <input className={"inp"} id={"obAmt"} inputMode={"decimal"} value={amount} onChange={(event) => setAmount(event.target.value)} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"obCur"}>{"Currency"}</label>
              <input className={"inp"} id={"obCur"} value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"obDate"}>{"As of"}</label>
              <input className={"inp"} id={"obDate"} type={"date"} value={asOf} onChange={(event) => setAsOf(event.target.value)} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"obDesc"}>{"Description"}</label>
              <input className={"inp"} id={"obDesc"} value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <p className={"fp-note"}>{`The source file still shows ${formatMoney(target.sourceAmountCents, target.sourceCurrency)}.`}</p>
          </div>
        ) : null}
        <div className={"fld"}>
          <label htmlFor={"obCode"}>{"Six-digit code"}</label>
          <input className={"inp"} id={"obCode"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className={"acts"}>
          <button type={"button"} className={"btn sm"} onClick={() => (document.getElementById("dlgOb") as HTMLDialogElement | null)?.close()}>{"Cancel"}</button>
          <button type={"button"} className={"btn p sm"} disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : mode === "approve" ? "Approve" : mode === "reject" ? "Reject" : "Save correction"}
          </button>
        </div>
      </dialog>
    </>
  );
}
