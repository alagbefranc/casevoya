"use client";

/**
 * Live only (DOC-01): Apply checklist on a matter's Documents tab. Choose an approved checklist,
 * preview what it would add, remove and what waits for an intake answer, tick what to keep, then
 * apply with the six-digit code. Nothing is added or removed without that confirmation;
 * public.apply_checklist accepts only what public.checklist_apply_preview proposes at that moment.
 * Built from the Designer's dialog parts (`.dlg`, `.fld`, `.sel`, `.check`, `.btn`).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import { applyChecklist, previewChecklist } from "@/modules/documents/checklist-actions";
import type { ChecklistProposals } from "@/modules/sheet/checklist-present";
import { Icon } from "./frame";

export type ApplyChecklistData = {
  organizationId: string;
  matterId: string;
  /** Approved checklists: "Spousal sponsorship v2". */
  templates: { id: string; label: string }[];
};

export function ApplyChecklist({ data }: { data: ApplyChecklistData }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [templateId, setTemplateId] = useState(data.templates[0]?.id ?? "");
  const [proposals, setProposals] = useState<ChecklistProposals | null>(null);
  const [adds, setAdds] = useState<Set<string>>(new Set());
  const [removes, setRemoves] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const addKey = (row: ChecklistProposals["add"][number]) => `${row.itemId}|${row.personId}`;

  const preview = async (id = templateId) => {
    if (!id || busy) return;
    setBusy(true);
    const result = await previewChecklist({ organizationId: data.organizationId, matterId: data.matterId, templateId: id });
    setBusy(false);
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
      return;
    }
    setProposals(result.proposals);
    setAdds(new Set(result.proposals.add.map(addKey)));
    setRemoves(new Set(result.proposals.remove.map((row) => row.requestId)));
  };

  const apply = async () => {
    if (!proposals || busy) return;
    if (adds.size + removes.size === 0) {
      toast2("Nothing is ticked", { kind: "warn", sub: "Tick what to add or remove, or close the dialog." });
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "Nothing was changed." });
      return;
    }
    setBusy(true);
    const result = await applyChecklist({
      organizationId: data.organizationId,
      matterId: data.matterId,
      templateId,
      add: proposals.add.filter((row) => adds.has(addKey(row))).map((row) => ({ itemId: row.itemId, personId: row.personId })),
      remove: proposals.remove.filter((row) => removes.has(row.requestId)).map((row) => row.requestId),
      code: code.trim(),
    });
    setBusy(false);
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
      if (/Preview it again/.test(result.error)) void preview();
      return;
    }
    dialog.current?.close();
    setCode("");
    setProposals(null);
    const parts = [result.created ? `${result.created} request${result.created === 1 ? "" : "s"} added` : "", result.cancelled ? `${result.cancelled} removed` : ""].filter(Boolean);
    toast2(parts.join(", ") || "Nothing changed", { kind: "ok", sub: "Clients see their requests in the portal, with the explanation and accepted formats." });
    router.refresh();
  };

  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };

  return (
    <>
      <button
        className={"btn s sm"}
        type={"button"}
        onClick={() => {
          dialog.current?.showModal();
          if (!proposals) void preview();
        }}
      >
        <Icon name={"file-check"} cls={"ic s"} />
        {"Apply checklist"}
      </button>
      <dialog className={"dlg wide"} ref={dialog} aria-labelledby={"acH"}>
        <div className={"dh"}>
          <h2 id={"acH"}>{"Apply checklist"}</h2>
          <button className={"x"} aria-label={"Close"} type={"button"} onClick={() => dialog.current?.close()}>
            <Icon name={"close"} cls={"ic s"} />
          </button>
        </div>
        <div className={"db"}>
          <div className={"fld"}>
            <label htmlFor={"acT"}>{"Checklist"}</label>
            <select
              className={"sel"}
              id={"acT"}
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setProposals(null);
                void preview(event.target.value);
              }}
            >
              {data.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </div>
          {proposals ? (
            <>
              <h3 className={"sub"}>{"To add"}</h3>
              {proposals.add.length ? (
                <ul className={"cl-list"}>
                  {proposals.add.map((row) => (
                    <li key={addKey(row)}>
                      <label className={"check"}>
                        <input type={"checkbox"} checked={adds.has(addKey(row))} onChange={(event) => setAdds(toggle(adds, addKey(row), event.target.checked))} />
                        <span>{`${row.purpose} · ${row.person}`}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={"cl-none"}>{"Nothing new: every item that applies is already requested."}</p>
              )}
              {proposals.remove.length ? (
                <>
                  <h3 className={"sub"}>{"No longer needed"}</h3>
                  <ul className={"cl-list"}>
                    {proposals.remove.map((row) => (
                      <li key={row.requestId}>
                        <label className={"check"}>
                          <input type={"checkbox"} checked={removes.has(row.requestId)} onChange={(event) => setRemoves(toggle(removes, row.requestId, event.target.checked))} />
                          <span>{`Remove ${row.purpose} · ${row.person} (${row.reason})`}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {proposals.waiting.length ? (
                <>
                  <h3 className={"sub"}>{"Waiting for an intake answer"}</h3>
                  <ul className={"cl-list"}>
                    {proposals.waiting.map((row, at) => (
                      <li key={at} className={"mu"}>{`${row.purpose} · ${row.person}: depends on “${row.field}”, not answered yet`}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <div className={"fld"}>
                <label htmlFor={"acC"}>{"Six-digit code"}</label>
                <input className={"inp"} id={"acC"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
              </div>
            </>
          ) : (
            <p className={"cl-none"}>{busy ? "Checking the matter’s people and answers…" : "Choose a checklist to see what it would add."}</p>
          )}
          <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
            <Icon name={"info"} cls={"ic s"} />
            {"Each request shows the checklist and version it came from. Removing one cancels it; nothing uploaded is deleted."}
          </p>
        </div>
        <div className={"df"}>
          <button className={"btn"} type={"button"} onClick={() => dialog.current?.close()}>
            {"Cancel"}
          </button>
          <button className={busy ? "btn p is-loading" : "btn p"} type={"button"} onClick={apply} disabled={!proposals}>
            {"Apply"}
          </button>
        </div>
      </dialog>
    </>
  );
}
