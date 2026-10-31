"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import {
  adoptSharedTemplate,
  clearFirmTemplateOverride,
  dismissSharedTemplateNotice,
  pinMatterSharedTemplate,
  saveFirmTemplateOverride,
} from "@/modules/templates/shared-actions";
import { copySharedTemplateToWorkflow } from "@/modules/templates/workflow-actions";
import {
  fieldLabel,
  isFirstVersion,
  type SharedTemplateCard,
  type SharedTemplatesView,
} from "@/modules/sheet/shared-template-present";
import { Badge } from "./designer/matters";
import { Empty } from "./designer/frame";

/**
 * ADM-03 firm view: published shared templates, the diff from the previous version, history,
 * adopt, a firm override kept apart from the reviewed text, and a pin on a matter.
 * Drafting and approving happen in the admin portal, not here.
 */
export function SharedTemplatesPanel({ organizationId, view, canCopy = false }: { organizationId: string; view: SharedTemplatesView; canCopy?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SharedTemplateCard | null>(null);
  const [clearing, setClearing] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [items, setItems] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [matterId, setMatterId] = useState(view.matters[0]?.id ?? "");

  function openEdit(card: SharedTemplateCard) {
    const source = card.override?.body ?? card.published?.body;
    setEditing(card);
    setTitle(source?.title ?? card.title);
    setSummary(source?.summary ?? "");
    setItems(source?.items.join("\n") ?? "");
    setReason("");
    setCode("");
    setClearing(false);
    (document.getElementById("dlgSt") as HTMLDialogElement | null)?.showModal();
  }

  function openClear(card: SharedTemplateCard) {
    setEditing(card);
    setClearing(true);
    setReason("");
    setCode("");
    (document.getElementById("dlgSt") as HTMLDialogElement | null)?.showModal();
  }

  async function run(task: () => Promise<{ ok: true } | { error: string }>, ok: string) {
    if (busy) return;
    setBusy(true);
    const result = await task();
    setBusy(false);
    if ("error" in result) {
      toast2(result.error, { kind: "bad" });
      return;
    }
    toast2(ok, { kind: "ok" });
    router.refresh();
  }

  async function saveOverride() {
    if (!editing) return;
    if (!/^\d{6}$/.test(code.trim())) {
      toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "Nothing was saved." });
      return;
    }
    await run(
      () =>
        saveFirmTemplateOverride({
          organizationId,
          templateId: editing.id,
          title,
          summary,
          items: items.split("\n").map((item) => item.trim()).filter(Boolean),
          reason,
          code: code.trim(),
        }),
      "Firm wording saved",
    );
    (document.getElementById("dlgSt") as HTMLDialogElement | null)?.close();
  }

  return (
    <>
      <div className={"ph rv"}>
        <div>
          <h1 className={"display"}>{"Shared templates"}</h1>
          <p><Badge badge={{ tone: "gr", label: "Casevoya shared · read only" }} /></p>
          <p>
            {"These versions were reviewed centrally. Your firm can adopt one. A matter that already uses a version keeps it. Your own wording is labelled as the firm’s, separate from the reviewed text."}
          </p>
        </div>
      </div>
      {view.notices.map((notice) => (
        <div key={notice.id} className={"alert rv"} role={"status"}>
          <div>
            <b>{notice.kind === "published" ? `New version of ${notice.title}` : `${notice.title} was rolled back`}</b>
            <p>{`Version ${notice.versionNumber}. ${notice.changelog}`}</p>
          </div>
          <button type={"button"} className={"btn sm"} onClick={() => void run(() => dismissSharedTemplateNotice({ organizationId, noticeId: notice.id }), "Notice hidden")}>
            {"Hide"}
          </button>
        </div>
      ))}
      {view.templates.length === 0 ? (
        <div className={"panel rv"}>
          <Empty art={"templates-empty"} title={"No shared template is published yet"} copy={"When a reviewed version is published, it shows here so the firm can adopt it. Nothing is published from this screen."} />
        </div>
      ) : null}
      {view.templates.map((card) => (
        <section key={card.id} className={"panel rv"} aria-labelledby={`st-${card.id}`}>
          <h2 id={`st-${card.id}`}>{card.title}</h2>
          <p className={"fp-note"}>{card.stableKey}</p>
          {card.published ? (
            <>
              <p>
                <Badge badge={{ tone: "ok", label: `Casevoya reviewed v${card.published.versionNumber}` }} />
                {card.adoption ? <Badge badge={{ tone: "blue", label: `Firm uses v${card.adoption.versionNumber}` }} /> : <Badge badge={{ tone: "chg", label: "Not adopted" }} />}
                {card.override ? <Badge badge={{ tone: "gr", label: "Firm wording" }} /> : null}
              </p>
              <p>{`Effective ${card.published.effectiveOn}. Author ${card.published.authorName}.${card.published.reviewerLabel ? ` Reviewed by ${card.published.reviewerLabel}.` : ""}`}</p>
              <p>{card.published.changelog}</p>
              <details className={"src"}>
                <summary>{"Test evidence"}</summary>
                <p>{card.published.testEvidence}</p>
              </details>
              <h3>{isFirstVersion(card.diff) ? "First published version" : "What changed"}</h3>
              <table className={"t"}>
                <caption className={"vh"}>{`Difference for ${card.title}`}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Field"}</th>
                    <th scope={"col"}>{"Previous"}</th>
                    <th scope={"col"}>{"This version"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(isFirstVersion(card.diff) ? card.diff.filter((change) => change.field === "title" || change.after) : card.diff).map((change) => (
                    <tr key={change.field}>
                      <th scope={"row"}>{fieldLabel(change.field)}</th>
                      <td style={{ whiteSpace: "pre-wrap" }}>{change.before || "—"}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{change.after || "—"}</td>
                    </tr>
                  ))}
                  {card.diff.length === 0 ? (
                    <tr>
                      <td colSpan={3}>{"This version matches the previous one."}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {card.override ? (
                <div className={"alert"}>
                  <b>{"Your firm’s wording"}</b>
                  <p>{`Based on v${card.override.basedOnVersionNumber}. ${card.override.reason}`}</p>
                  <p style={{ whiteSpace: "pre-wrap" }}>{card.override.body.items.join("\n")}</p>
                </div>
              ) : null}
              <h3>{"History"}</h3>
              <table className={"t"}>
                <caption className={"vh"}>{`History of ${card.title}`}</caption>
                <thead>
                  <tr>
                    <th scope={"col"}>{"Version"}</th>
                    <th scope={"col"}>{"Status"}</th>
                    <th scope={"col"}>{"Author"}</th>
                    <th scope={"col"}>{"Reviewer"}</th>
                    <th scope={"col"}>{"Effective"}</th>
                    <th scope={"col"}>{"Changelog"}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...card.history].reverse().map((version) => (
                    <tr key={version.id}>
                      <td className={"num"}>{`v${version.versionNumber}`}</td>
                      <td>{version.status === "published" ? "Published" : version.status === "rolled_back" ? "Rolled back" : "Superseded"}</td>
                      <td>{version.authorName}</td>
                      <td>{version.reviewerLabel ?? "—"}</td>
                      <td className={"num"}>{version.effectiveOn}</td>
                      <td>{version.changelog}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={"fp-note"}>{`${card.pins} ${card.pins === 1 ? "matter uses" : "matters use"} a pinned version. A new publication does not move those pins.`}</p>
              <div className={"acts"}>
                {view.canAdopt && card.adoption?.versionId !== card.published.id ? (
                  <button type={"button"} className={"btn p sm"} disabled={busy} onClick={() => void run(() => adoptSharedTemplate({ organizationId, versionId: card.published!.id }), `Adopted v${card.published!.versionNumber}`)}>
                    {`Adopt v${card.published.versionNumber}`}
                  </button>
                ) : null}
                {canCopy ? (
                  <button
                    type={"button"}
                    className={"btn sm"}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const copied = await copySharedTemplateToWorkflow({ organizationId, versionId: card.published!.id });
                        return "error" in copied ? copied : { ok: true as const };
                      }, `Copy made in Workflows. Edit it there; this template stays read only.`)
                    }
                  >
                    {"Make a copy to edit"}
                  </button>
                ) : null}
                {view.canOverride ? (
                  <button type={"button"} className={"btn sm"} onClick={() => openEdit(card)}>{"Edit firm wording"}</button>
                ) : null}
                {view.canOverride && card.override ? (
                  <button type={"button"} className={"btn sm"} onClick={() => openClear(card)}>
                    {"Use the reviewed wording"}
                  </button>
                ) : null}
              </div>
              {view.canPin && card.adoption?.versionId === card.published.id && view.matters.length ? (
                <form
                  className={"g2"}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => pinMatterSharedTemplate({ organizationId, matterId, templateId: card.id }), "Version pinned on the matter");
                  }}
                >
                  <div className={"fld"}>
                    <label htmlFor={`pin-${card.id}`}>{"Pin this version on a matter"}</label>
                    <select className={"sel"} id={`pin-${card.id}`} value={matterId} onChange={(event) => setMatterId(event.target.value)}>
                      {view.matters.map((matter) => (
                        <option key={matter.id} value={matter.id}>{matter.title}</option>
                      ))}
                    </select>
                  </div>
                  <button type={"submit"} className={"btn sm"} disabled={busy}>{"Pin"}</button>
                </form>
              ) : null}
            </>
          ) : (
            <p>{"No version of this template is published."}</p>
          )}
        </section>
      ))}
      <dialog className={"dlg"} id={"dlgSt"} aria-labelledby={"dlgStH"}>
        <h2 id={"dlgStH"}>{clearing ? "Use the reviewed wording" : "Firm wording"}</h2>
        <p>{clearing ? "The firm’s wording is set aside. The reviewed version is what staff see as Casevoya’s text." : "This is your firm’s text. The reviewed version stays as it was published."}</p>
        {clearing ? null : (
          <>
            <div className={"fld"}>
              <label htmlFor={"stTitle"}>{"Title"}</label>
              <input className={"inp"} id={"stTitle"} value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"stSum"}>{"Summary"}</label>
              <textarea className={"ta"} id={"stSum"} value={summary} onChange={(event) => setSummary(event.target.value)} />
            </div>
            <div className={"fld"}>
              <label htmlFor={"stItems"}>{"Items, one per line"}</label>
              <textarea className={"ta"} id={"stItems"} value={items} onChange={(event) => setItems(event.target.value)} />
            </div>
          </>
        )}
        <div className={"fld"}>
          <label htmlFor={"stReason"}>{"Reason"}</label>
          <textarea className={"ta"} id={"stReason"} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <div className={"fld"}>
          <label htmlFor={"stCode"}>{"Six-digit code"}</label>
          <input className={"inp"} id={"stCode"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <div className={"acts"}>
          <button type={"button"} className={"btn sm"} onClick={() => (document.getElementById("dlgSt") as HTMLDialogElement | null)?.close()}>{"Cancel"}</button>
          <button
            type={"button"}
            className={"btn p sm"}
            disabled={busy}
            onClick={() => {
              if (!editing) return;
              if (clearing) {
                if (!/^\d{6}$/.test(code.trim())) {
                  toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "Nothing was saved." });
                  return;
                }
                void run(() => clearFirmTemplateOverride({ organizationId, templateId: editing.id, reason, code: code.trim() }), "Firm wording cleared");
                (document.getElementById("dlgSt") as HTMLDialogElement | null)?.close();
                return;
              }
              void saveOverride();
            }}
          >
            {clearing ? "Clear firm wording" : "Save firm wording"}
          </button>
        </div>
      </dialog>
    </>
  );
}
