"use client";

/**
 * Live only (2026-10-30): Templates > Workflows. The firm's own workflows as `.fp-card`s with
 * Edit, Duplicate and Archive or Restore, and the Casevoya shared templates (read only) with
 * Make a copy to edit. The editor (`#dlgWf`, built from the Designer's `.dlg` parts) is opened by
 * the header's New workflow button or by Edit. public.save_firm_workflow,
 * public.copy_shared_template_to_workflow and public.set_firm_workflow_archived check the role
 * (firm owner or licensed consultant), the firm and every field, and write the audit log.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast2 } from "@/components/port/kit";
import { copySharedTemplateToWorkflow, saveFirmWorkflow, setFirmWorkflowArchived } from "@/modules/templates/workflow-actions";
import {
  blankItem,
  blankStage,
  MAX_ITEMS_PER_STAGE,
  MAX_STAGES,
  move,
  workflowProblem,
  workflowProgram,
  workflowSummary,
  type WorkflowItemInput,
  type WorkflowsLiveData,
  type WorkflowStageInput,
  type WorkflowView,
} from "@/modules/sheet/workflows-present";
import { Empty, Icon } from "./frame";
import { Badge } from "./matters";

export const WORKFLOW_DIALOG = "dlgWf";

type Draft = { workflowId: string | null; expectedVersion: number | null; name: string; programKey: string; description: string; stages: WorkflowStageInput[] };

const fresh = (): Draft => ({ workflowId: null, expectedVersion: null, name: "", programKey: "", description: "", stages: [blankStage()] });

function IconButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className={"btn s sm wf-ib"} type={"button"} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} cls={"ic s"} />
    </button>
  );
}

export function WorkflowsLive({ data }: { data: WorkflowsLiveData }) {
  const router = useRouter();
  const editor = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft>(fresh);
  const [busy, setBusy] = useState<string | null>(null);
  const active = data.workflows.filter((workflow) => workflow.status === "active");
  const archived = data.workflows.filter((workflow) => workflow.status === "archived");
  const copyOf = new Map(active.filter((workflow) => workflow.copiedFrom).map((workflow) => [workflow.copiedFrom!.templateId, workflow]));

  const open = (next: Draft) => {
    setDraft(next);
    editor.current?.showModal();
  };
  const edit = (workflow: WorkflowView) =>
    open({
      workflowId: workflow.id,
      expectedVersion: workflow.rowVersion,
      name: workflow.name,
      programKey: workflow.programKey ?? "",
      description: workflow.description,
      stages: workflow.stages.length ? workflow.stages.map((stage) => ({ name: stage.name, items: stage.items.map((item) => ({ ...item })) })) : [blankStage()],
    });
  const duplicate = (workflow: WorkflowView) =>
    open({
      workflowId: null,
      expectedVersion: null,
      name: `${workflow.name} (copy)`.slice(0, 160),
      programKey: workflow.programKey ?? "",
      description: workflow.description,
      stages: workflow.stages.map((stage) => ({ name: stage.name, items: stage.items.map((item) => ({ ...item })) })),
    });

  const setStage = (index: number, patch: Partial<WorkflowStageInput>) =>
    setDraft((current) => ({ ...current, stages: current.stages.map((stage, at) => (at === index ? { ...stage, ...patch } : stage)) }));
  const setItems = (stageIndex: number, update: (items: WorkflowItemInput[]) => WorkflowItemInput[]) =>
    setDraft((current) => ({ ...current, stages: current.stages.map((stage, at) => (at === stageIndex ? { ...stage, items: update(stage.items) } : stage)) }));
  const setItem = (stageIndex: number, itemIndex: number, patch: Partial<WorkflowItemInput>) =>
    setItems(stageIndex, (items) => items.map((item, at) => (at === itemIndex ? { ...item, ...patch } : item)));

  const save = async () => {
    if (busy) return;
    const problem = workflowProblem(draft.name, draft.stages);
    if (problem) {
      toast2(problem, { kind: "bad", sub: "The workflow wasn’t saved." });
      return;
    }
    setBusy("save");
    const result = await saveFirmWorkflow({ organizationId: data.organizationId, ...draft });
    setBusy(null);
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "The workflow wasn’t saved." });
      return;
    }
    editor.current?.close();
    toast2(draft.workflowId ? "Workflow saved" : "Workflow created", { kind: "ok", sub: "Only your firm sees it. Casevoya’s shared templates are not changed." });
    router.refresh();
  };

  const copy = async (versionId: string, title: string) => {
    if (busy) return;
    setBusy(versionId);
    const result = await copySharedTemplateToWorkflow({ organizationId: data.organizationId, versionId });
    setBusy(null);
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "No copy was made." });
      return;
    }
    toast2(`Copy of ${title} made`, { kind: "ok", sub: "It’s your firm’s workflow now. Edit it below; the shared template stays as Casevoya published it." });
    router.refresh();
  };

  const archive = async (workflow: WorkflowView, value: boolean) => {
    if (busy) return;
    setBusy(workflow.id);
    const result = await setFirmWorkflowArchived({ organizationId: data.organizationId, workflowId: workflow.id, expectedVersion: workflow.rowVersion, archived: value });
    setBusy(null);
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: value ? "Nothing was archived." : "Nothing was restored." });
      return;
    }
    toast2(value ? `${workflow.name} archived` : `${workflow.name} restored`, { kind: "ok", sub: value ? "Nothing was deleted. Restore it from Archived at any time." : "It’s back in your firm’s workflows." });
    router.refresh();
  };

  const card = (workflow: WorkflowView) => (
    <div key={workflow.id} className={"fp-card"}>
      <h3>{workflow.name}</h3>
      <p>{`${workflowProgram(workflow.programKey, data.programs)} · ${workflowSummary(workflow)}`}</p>
      {workflow.description ? <p className={"wf-desc"}>{workflow.description}</p> : null}
      <p className={"wf-tags"}>
        <Badge badge={workflow.status === "archived" ? { tone: "gr", label: "Archived" } : { tone: "blue", label: data.edit ? "Your firm · editable" : "Your firm" }} />
        {workflow.copiedFrom ? <span className={"fp-tag"}>{`Copied from ${workflow.copiedFrom.title}${workflow.copiedFrom.versionNumber ? ` v${workflow.copiedFrom.versionNumber}` : ""}`}</span> : null}
      </p>
      {workflow.stages.length ? (
        <ol className={"wf-stages"}>
          {workflow.stages.map((stage, index) => (
            <li key={index}>
              <b>{stage.name}</b>
              <span>{` · ${stage.items.length} ${stage.items.length === 1 ? "item" : "items"}`}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {data.edit ? (
        <div className={"cl-acts"}>
          {workflow.status === "active" ? (
            <>
              <button className={"btn p sm"} type={"button"} onClick={() => edit(workflow)}>
                <Icon name={"edit"} cls={"ic s"} />
                {"Edit"}
              </button>
              <button className={"btn s sm"} type={"button"} onClick={() => duplicate(workflow)}>
                <Icon name={"copy"} cls={"ic s"} />
                {"Duplicate"}
              </button>
              <button className={busy === workflow.id ? "btn s sm is-loading" : "btn s sm"} type={"button"} onClick={() => void archive(workflow, true)}>
                <Icon name={"archive"} cls={"ic s"} />
                {"Archive"}
              </button>
            </>
          ) : (
            <button className={busy === workflow.id ? "btn s sm is-loading" : "btn s sm"} type={"button"} onClick={() => void archive(workflow, false)}>
              <Icon name={"undo"} cls={"ic s"} />
              {"Restore"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {!data.edit ? (
        <p className={"lock rv"} style={{ fontSize: "13.5px", margin: "0 0 12px" }}>
          <Icon name={"lock"} cls={"ic s"} />
          {"You can read your firm’s workflows. A firm owner or a licensed consultant creates and changes them."}
        </p>
      ) : null}

      <h2 className={"wf-h rv"}>{"Your firm’s workflows"}</h2>
      {active.length === 0 ? (
        <div className={"panel rv"}>
          <Empty
            art={"templates-empty"}
            title={"No workflows yet"}
            copy={data.edit ? "Choose New workflow to build one from scratch, or make a copy of a Casevoya shared template below and edit your copy." : "Your firm hasn’t made a workflow yet."}
          >
            {data.edit ? (
              <button className={"btn p sm"} type={"button"} data-dlg={WORKFLOW_DIALOG}>
                <Icon name={"plus"} cls={"ic s"} />
                {"New workflow"}
              </button>
            ) : null}
          </Empty>
        </div>
      ) : (
        <div className={"fp-cards rv"}>{active.map(card)}</div>
      )}

      <h2 className={"wf-h rv"}>
        {"Casevoya shared templates "}
        <Badge badge={{ tone: "gr", label: "Read only" }} />
      </h2>
      <p className={"fp-note rv"} style={{ marginTop: 0 }}>{"Casevoya publishes these after a licensed review. Your firm can’t change them; make a copy to get your own editable workflow. A later Casevoya release doesn’t change your copy."}</p>
      {data.sharedFailed ? (
        <div className={"panel rv"}>
          <Empty art={"templates-empty"} title={"Shared templates couldn’t load"} copy={"Reload the page. Nothing was changed."} />
        </div>
      ) : data.shared.length === 0 ? (
        <div className={"panel rv"}>
          <Empty art={"templates-empty"} title={"No shared template is published yet"} copy={"When Casevoya publishes a reviewed template it shows here, and you can make your firm’s own copy to edit."} />
        </div>
      ) : (
        <div className={"fp-cards rv"}>
          {data.shared.map((template) => {
            const existing = copyOf.get(template.templateId);
            return (
              <div key={template.templateId} className={"fp-card"}>
                <h3>{template.title}</h3>
                <p>{template.summary || `${template.items} ${template.items === 1 ? "item" : "items"}`}</p>
                <p className={"wf-tags"}>
                  <Badge badge={{ tone: "ok", label: `Casevoya shared template v${template.versionNumber}` }} />
                  <span className={"fp-tag"}>{"Read only"}</span>
                </p>
                <div className={"cl-acts"}>
                  {data.edit ? (
                    <button className={busy === template.versionId ? "btn p sm is-loading" : "btn p sm"} type={"button"} onClick={() => void copy(template.versionId, template.title)}>
                      <Icon name={"copy"} cls={"ic s"} />
                      {existing ? "Make another copy" : "Make a copy to edit"}
                    </button>
                  ) : null}
                  {existing && data.edit ? (
                    <button className={"btn s sm"} type={"button"} onClick={() => edit(existing)}>
                      {"Open your copy"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {archived.length ? (
        <details className={"phx wf-archived rv"}>
          <summary className={"btn s sm"}>{`Archived (${archived.length})`}</summary>
          <div className={"fp-cards"}>{archived.map(card)}</div>
        </details>
      ) : null}

      {data.edit ? (
        <dialog className={"dlg wide"} id={WORKFLOW_DIALOG} ref={editor} aria-labelledby={"wfH"} onClose={() => setDraft(fresh())}>
          <div className={"dh"}>
            <h2 id={"wfH"}>{draft.workflowId ? "Edit workflow" : "New workflow"}</h2>
            <button className={"x"} aria-label={"Close"} type={"button"} onClick={() => editor.current?.close()}>
              <Icon name={"close"} cls={"ic s"} />
            </button>
          </div>
          <div className={"db"}>
            <div className={"g2 wf-g2"}>
              <div className={"fld"}>
                <label htmlFor={"wfName"}>{"Name"}</label>
                <input className={"inp"} id={"wfName"} maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </div>
              <div className={"fld"}>
                <label htmlFor={"wfProgram"}>{"Program"}</label>
                <select className={"sel"} id={"wfProgram"} value={draft.programKey} onChange={(event) => setDraft({ ...draft, programKey: event.target.value })}>
                  <option value={""}>{"Any program"}</option>
                  {data.programs.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {draft.programKey && !data.programs.some((option) => option.value === draft.programKey) ? (
                    <option value={draft.programKey}>{workflowProgram(draft.programKey, [])}</option>
                  ) : null}
                </select>
              </div>
            </div>
            <div className={"fld"}>
              <label htmlFor={"wfDesc"}>{"Description (optional)"}</label>
              <textarea className={"ta"} id={"wfDesc"} maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}></textarea>
            </div>
            {draft.stages.map((stage, stageIndex) => {
              const sid = `wfS${stageIndex}`;
              return (
                <fieldset key={stageIndex} className={"cl-item wf-stage"}>
                  <legend>{`Stage ${stageIndex + 1}`}</legend>
                  <div className={"wf-row"}>
                    <div className={"fld wf-grow"}>
                      <label htmlFor={`${sid}n`}>{"Stage name"}</label>
                      <input className={"inp"} id={`${sid}n`} maxLength={120} value={stage.name} onChange={(event) => setStage(stageIndex, { name: event.target.value })} />
                    </div>
                    <div className={"wf-moves"}>
                      <IconButton icon={"move-up"} label={`Move stage ${stageIndex + 1} up`} disabled={stageIndex === 0} onClick={() => setDraft({ ...draft, stages: move(draft.stages, stageIndex, -1) })} />
                      <IconButton icon={"move-down"} label={`Move stage ${stageIndex + 1} down`} disabled={stageIndex === draft.stages.length - 1} onClick={() => setDraft({ ...draft, stages: move(draft.stages, stageIndex, 1) })} />
                      <IconButton icon={"trash"} label={`Remove stage ${stageIndex + 1}`} disabled={draft.stages.length === 1} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, at) => at !== stageIndex) })} />
                    </div>
                  </div>
                  <ol className={"wf-items"}>
                    {stage.items.map((item, itemIndex) => {
                      const iid = `${sid}i${itemIndex}`;
                      return (
                        <li key={itemIndex} className={"wf-item"}>
                          <div className={"fld wf-kind"}>
                            <label htmlFor={`${iid}k`}>{"Type"}</label>
                            <select
                              className={"sel"}
                              id={`${iid}k`}
                              value={item.kind}
                              onChange={(event) => setItem(stageIndex, itemIndex, { kind: event.target.value === "document" ? "document" : "step", ...(event.target.value === "document" ? { owner: "client" as const } : {}) })}
                            >
                              <option value={"step"}>{"Step"}</option>
                              <option value={"document"}>{"Document to request"}</option>
                            </select>
                          </div>
                          <div className={"fld wf-grow"}>
                            <label htmlFor={`${iid}t`}>{item.kind === "document" ? "Document" : "Step"}</label>
                            <input className={"inp"} id={`${iid}t`} maxLength={200} value={item.title} onChange={(event) => setItem(stageIndex, itemIndex, { title: event.target.value })} />
                          </div>
                          <div className={"fld wf-owner"}>
                            <label htmlFor={`${iid}o`}>{item.kind === "document" ? "Provided by" : "Done by"}</label>
                            <select className={"sel"} id={`${iid}o`} value={item.owner} onChange={(event) => setItem(stageIndex, itemIndex, { owner: event.target.value === "client" ? "client" : "staff" })}>
                              <option value={"staff"}>{"The firm"}</option>
                              <option value={"client"}>{"The client"}</option>
                            </select>
                          </div>
                          <div className={"fld wf-days"}>
                            <label htmlFor={`${iid}d`}>{"Due after (days)"}</label>
                            <input
                              className={"inp"}
                              id={`${iid}d`}
                              type={"number"}
                              min={0}
                              max={365}
                              placeholder={"—"}
                              value={item.due_offset_days ?? ""}
                              onChange={(event) =>
                                setItem(stageIndex, itemIndex, { due_offset_days: event.target.value === "" ? null : Math.max(0, Math.min(365, Math.round(Number(event.target.value)))) })
                              }
                            />
                          </div>
                          <div className={"wf-moves"}>
                            <IconButton icon={"move-up"} label={`Move item ${itemIndex + 1} up`} disabled={itemIndex === 0} onClick={() => setItems(stageIndex, (items) => move(items, itemIndex, -1))} />
                            <IconButton
                              icon={"move-down"}
                              label={`Move item ${itemIndex + 1} down`}
                              disabled={itemIndex === stage.items.length - 1}
                              onClick={() => setItems(stageIndex, (items) => move(items, itemIndex, 1))}
                            />
                            <IconButton icon={"trash"} label={`Remove item ${itemIndex + 1}`} onClick={() => setItems(stageIndex, (items) => items.filter((_, at) => at !== itemIndex))} />
                          </div>
                          <div className={"fld wf-detail"}>
                            <label htmlFor={`${iid}x`}>{"Note (optional)"}</label>
                            <input className={"inp"} id={`${iid}x`} maxLength={2000} value={item.detail} onChange={(event) => setItem(stageIndex, itemIndex, { detail: event.target.value })} />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <div className={"cl-acts"}>
                    <button className={"btn s sm"} type={"button"} disabled={stage.items.length >= MAX_ITEMS_PER_STAGE} onClick={() => setItems(stageIndex, (items) => [...items, blankItem("step")])}>
                      <Icon name={"plus"} cls={"ic s"} />
                      {"Add a step"}
                    </button>
                    <button className={"btn s sm"} type={"button"} disabled={stage.items.length >= MAX_ITEMS_PER_STAGE} onClick={() => setItems(stageIndex, (items) => [...items, blankItem("document")])}>
                      <Icon name={"plus"} cls={"ic s"} />
                      {"Add a document request"}
                    </button>
                  </div>
                </fieldset>
              );
            })}
            <button className={"btn s sm"} type={"button"} disabled={draft.stages.length >= MAX_STAGES} onClick={() => setDraft({ ...draft, stages: [...draft.stages, blankStage()] })}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Add a stage"}
            </button>
            <p className={"lock"} style={{ fontSize: "13.5px", marginTop: "10px" }}>
              <Icon name={"info"} cls={"ic s"} />
              {"Your firm’s own workflow. Saving never changes a Casevoya shared template. Empty steps are left out."}
            </p>
          </div>
          <div className={"df"}>
            <button className={"btn"} type={"button"} onClick={() => editor.current?.close()}>
              {"Cancel"}
            </button>
            <button className={busy === "save" ? "btn p is-loading" : "btn p"} type={"button"} onClick={() => void save()}>
              {draft.workflowId ? "Save workflow" : "Create workflow"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
