"use client";

/**
 * Live only (DOC-01): Templates > Checklists for the firm. The same `.fp-cards` / `.fp-card` as
 * the Designer's tab, from the firm's checklist templates, plus New checklist, Edit and New version
 * (the editor dialog, built from the Designer's `.dlg` parts) and Approve for a licensed consultant
 * (the six-digit code). public.save_checklist_template and public.approve_checklist_template check
 * the role, the step-up and every field.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import { approveChecklistTemplate, saveChecklistTemplate } from "@/modules/documents/checklist-actions";
import {
  CHECKLIST_FORMATS,
  CHECKLIST_ROLES,
  checklistCard,
  itemKey,
  keyFromTitle,
  type ChecklistItemInput,
  type ChecklistsLiveData,
  type ChecklistTemplateView,
} from "@/modules/sheet/checklist-present";
import { Icon, Pair } from "./frame";

const blank = (used: ReadonlySet<string>): ChecklistItemInput => ({
  item_key: itemKey("item", used),
  purpose: "",
  explanation: "",
  owner: "client",
  due_offset_days: 14,
  acceptable_formats: ["pdf"],
  review_criteria: "",
  records_expiry: false,
  party_role: "",
  condition_field: "",
  condition_equals: "",
});

type Draft = { templateId: string | null; stableKey: string; title: string; items: ChecklistItemInput[] };

export function ChecklistsLive({ data }: { data: ChecklistsLiveData }) {
  const router = useRouter();
  const editor = useRef<HTMLDialogElement>(null);
  const approver = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [approving, setApproving] = useState<ChecklistTemplateView | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (next: Draft) => {
    setDraft(next);
    editor.current?.showModal();
  };
  const startNew = () => open({ templateId: null, stableKey: "", title: "", items: [blank(new Set())] });
  const edit = (template: ChecklistTemplateView) =>
    open({ templateId: template.status === "draft" ? template.id : null, stableKey: template.stableKey, title: template.title, items: template.items.map((item) => ({ ...item })) });

  const setItem = (index: number, patch: Partial<ChecklistItemInput>) =>
    setDraft((current) => (current ? { ...current, items: current.items.map((item, at) => (at === index ? { ...item, ...patch } : item)) } : current));

  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    const used = new Set<string>();
    const items = draft.items.map((item) => {
      const key = item.item_key && !used.has(item.item_key) ? item.item_key : itemKey(item.purpose || "item", used);
      used.add(key);
      return { ...item, item_key: key };
    });
    const result = await saveChecklistTemplate({ organizationId: data.organizationId, templateId: draft.templateId, stableKey: draft.stableKey || keyFromTitle(draft.title), title: draft.title, items });
    setBusy(false);
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "The checklist wasn’t saved." });
      return;
    }
    editor.current?.close();
    toast2("Checklist saved as a draft", { kind: "ok", sub: "A licensed consultant approves it before it can be applied to a matter." });
    router.refresh();
  };

  const approve = async () => {
    if (!approving || busy) return;
    if (!/^\d{6}$/.test(code.trim())) {
      toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "Nothing was approved." });
      return;
    }
    setBusy(true);
    const result = await approveChecklistTemplate({ organizationId: data.organizationId, templateId: approving.id, expectedVersion: approving.rowVersion, code: code.trim() });
    setBusy(false);
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "Nothing was approved." });
      return;
    }
    approver.current?.close();
    setCode("");
    toast2(`${approving.title} v${approving.versionNumber} approved`, { kind: "ok", sub: "Staff can now apply it to a matter. An earlier approved version is retired." });
    router.refresh();
  };

  return (
    <>
      {data.edit ? (
          <div className={"ph-act"}>
            <button className={"btn p sm"} type={"button"} onClick={startNew}>
              <Icon name={"plus"} cls={"ic s"} />
              {"New checklist"}
            </button>
          </div>
      ) : null}
      <div className={"fp-cards rv"} style={{ "--i": "1" } as React.CSSProperties}>
        {data.templates.map((template) => {
          const card = checklistCard(template);
          return (
            <div key={template.id} className={"fp-card"}>
              <h3>
                <Pair left={card.title.left} right={card.title.right} />
              </h3>
              <p>
                <Pair left={card.note.left} right={card.note.right} />
              </p>
              <span className={"fp-tag"} style={{ marginTop: "8px" }}>
                {card.tag}
              </span>
              <div className={"cl-acts"}>
                {data.edit && template.status !== "retired" ? (
                  <button className={"btn s sm"} type={"button"} onClick={() => edit(template)}>
                    {template.status === "draft" ? "Edit" : "New version"}
                  </button>
                ) : null}
                {data.approve && template.status === "draft" ? (
                  <button
                    className={"btn s sm"}
                    type={"button"}
                    onClick={() => {
                      setApproving(template);
                      approver.current?.showModal();
                    }}
                  >
                    {"Approve"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {data.edit ? (
        <dialog className={"dlg wide"} ref={editor} aria-labelledby={"clH"}>
          <div className={"dh"}>
            <h2 id={"clH"}>{draft?.templateId ? "Edit checklist" : draft?.stableKey ? "New version" : "New checklist"}</h2>
            <button className={"x"} aria-label={"Close"} type={"button"} onClick={() => editor.current?.close()}>
              <Icon name={"close"} cls={"ic s"} />
            </button>
          </div>
          {draft ? (
            <div className={"db"}>
              <div className={"fld"}>
                <label htmlFor={"clTitle"}>{"Title"}</label>
                <input className={"inp"} id={"clTitle"} maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </div>
              {draft.items.map((item, index) => {
                const id = `cl${index}`;
                const question = data.conditions.find((option) => option.key === item.condition_field);
                return (
                  <fieldset key={index} className={"cl-item"}>
                    <legend>{`Item ${index + 1}`}</legend>
                    <div className={"g2"}>
                      <div className={"fld"}>
                        <label htmlFor={`${id}p`}>{"Type of document"}</label>
                        <input className={"inp"} id={`${id}p`} maxLength={200} value={item.purpose} onChange={(event) => setItem(index, { purpose: event.target.value })} />
                      </div>
                      <div className={"fld"}>
                        <label htmlFor={`${id}r`}>{"Who it’s for"}</label>
                        <select className={"sel"} id={`${id}r`} value={item.party_role} onChange={(event) => setItem(index, { party_role: event.target.value })}>
                          {CHECKLIST_ROLES.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className={"fld"}>
                      <label htmlFor={`${id}e`}>{"Explanation for the client"}</label>
                      <textarea className={"ta"} id={`${id}e`} maxLength={2000} value={item.explanation} onChange={(event) => setItem(index, { explanation: event.target.value })}></textarea>
                    </div>
                    <div className={"g2"}>
                      <div className={"fld"}>
                        <label htmlFor={`${id}o`}>{"Provided by"}</label>
                        <select className={"sel"} id={`${id}o`} value={item.owner} onChange={(event) => setItem(index, { owner: event.target.value === "staff" ? "staff" : "client" })}>
                          <option value={"client"}>{"The client (in their portal)"}</option>
                          <option value={"staff"}>{"The firm (not shown to the client)"}</option>
                        </select>
                      </div>
                      <div className={"fld"}>
                        <label htmlFor={`${id}d`}>{"Due after (days)"}</label>
                        <input
                          className={"inp"}
                          id={`${id}d`}
                          type={"number"}
                          min={0}
                          max={365}
                          value={item.due_offset_days ?? ""}
                          onChange={(event) => setItem(index, { due_offset_days: event.target.value === "" ? null : Math.max(0, Math.min(365, Math.round(Number(event.target.value)))) })}
                        />
                      </div>
                    </div>
                    <div className={"fld"}>
                      <span className={"lbl"}>{"Accepted formats"}</span>
                      <div className={"cl-formats"}>
                        {CHECKLIST_FORMATS.map((format) => (
                          <label key={format.value} className={"check"}>
                            <input
                              type={"checkbox"}
                              checked={item.acceptable_formats.includes(format.value)}
                              onChange={(event) =>
                                setItem(index, { acceptable_formats: event.target.checked ? [...item.acceptable_formats, format.value] : item.acceptable_formats.filter((value) => value !== format.value) })
                              }
                            />
                            <span>{format.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className={"fld"}>
                      <label htmlFor={`${id}c`}>{"What staff check when reviewing (optional)"}</label>
                      <input className={"inp"} id={`${id}c`} maxLength={2000} value={item.review_criteria} onChange={(event) => setItem(index, { review_criteria: event.target.value })} />
                    </div>
                    <label className={"check"}>
                      <input type={"checkbox"} checked={item.records_expiry} onChange={(event) => setItem(index, { records_expiry: event.target.checked })} />
                      <span>{"It has an expiry date to record"}</span>
                    </label>
                    <div className={"g2"}>
                      <div className={"fld"}>
                        <label htmlFor={`${id}q`}>{"Only when this intake answer…"}</label>
                        <select className={"sel"} id={`${id}q`} value={item.condition_field} onChange={(event) => setItem(index, { condition_field: event.target.value, condition_equals: "" })}>
                          <option value={""}>{"Always"}</option>
                          {data.conditions.map((option) => (
                            <option key={option.key} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={"fld"}>
                        <label htmlFor={`${id}a`}>{"…is"}</label>
                        <select className={"sel"} id={`${id}a`} value={item.condition_equals} disabled={!question} onChange={(event) => setItem(index, { condition_equals: event.target.value })}>
                          <option value={""}>{question ? "Choose an answer" : "—"}</option>
                          {(question?.answers ?? []).map((answer) => (
                            <option key={answer} value={answer}>
                              {answer}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {draft.items.length > 1 ? (
                      <button className={"btn s sm"} type={"button"} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, at) => at !== index) })}>
                        {"Remove item"}
                      </button>
                    ) : null}
                  </fieldset>
                );
              })}
              <button className={"btn s sm"} type={"button"} onClick={() => setDraft({ ...draft, items: [...draft.items, blank(new Set(draft.items.map((item) => item.item_key)))] })}>
                <Icon name={"plus"} cls={"ic s"} />
                {"Add an item"}
              </button>
              <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
                <Icon name={"info"} cls={"ic s"} />
                {"Saved as a draft. It reaches clients only after a licensed consultant approves it; an approved version never changes."}
              </p>
            </div>
          ) : null}
          <div className={"df"}>
            <button className={"btn"} type={"button"} onClick={() => editor.current?.close()}>
              {"Cancel"}
            </button>
            <button className={busy ? "btn p is-loading" : "btn p"} type={"button"} onClick={save}>
              {"Save draft"}
            </button>
          </div>
        </dialog>
      ) : null}

      {data.approve ? (
        <dialog className={"dlg"} ref={approver} aria-labelledby={"claH"}>
          <div className={"dh"}>
            <h2 id={"claH"}>{"Approve checklist"}</h2>
            <button className={"x"} aria-label={"Close"} type={"button"} onClick={() => approver.current?.close()}>
              <Icon name={"close"} cls={"ic s"} />
            </button>
          </div>
          <div className={"db"}>
            <p style={{ marginBottom: "12px" }}>{approving ? `${approving.title} v${approving.versionNumber}, ${approving.items.length} items. Once approved it doesn’t change, and staff can apply it to matters.` : ""}</p>
            <div className={"fld"}>
              <label htmlFor={"claC"}>{"Six-digit code"}</label>
              <input className={"inp"} id={"claC"} inputMode={"numeric"} autoComplete={"one-time-code"} maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
            </div>
          </div>
          <div className={"df"}>
            <button className={"btn"} type={"button"} onClick={() => approver.current?.close()}>
              {"Cancel"}
            </button>
            <button className={busy ? "btn p is-loading" : "btn p"} type={"button"} onClick={approve}>
              {"Approve"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
