import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TasksDialog, type TasksDialogData } from "@/components/sheet/designer/tasks";
import { TasksMarkup } from "@/components/sheet/markup/tasks";
import {
  clientOptions,
  dependencyError,
  dependsOnOptions,
  dueDate,
  matterOptions,
  newTaskError,
  optionFits,
  readNewTask,
  staffOptions,
  taskAudience,
} from "@/modules/sheet/new-task";

const MATTER = "6f0c1d1e-8a3f-4b55-9d61-3b1d2c4e5f60";
const OTHER = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const AMARA = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const ANA = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
const EARLIER = "3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f";

describe("new task options", () => {
  it("names matters by reference and client, and marks sample matters", () => {
    const name = (id: string) => (id === MATTER ? "Ana Pereira" : "Sample file");
    expect(
      matterOptions(
        [
          { id: MATTER, reference: "NL-2026-0142", is_sample: false },
          { id: OTHER, reference: null, is_sample: true },
        ],
        name,
      ),
    ).toEqual([
      { value: MATTER, label: "NL-2026-0142 · Ana Pereira" },
      { value: OTHER, label: "Sample file (sample)" },
    ]);
  });

  it("offers staff for internal tasks and each matter's people for client tasks", () => {
    expect(staffOptions([{ id: "b", name: "Lena Park" }, { id: "a", name: "Amara Osei" }])).toEqual([
      { value: "a", label: "Amara Osei", kind: "internal" },
      { value: "b", label: "Lena Park", kind: "internal" },
    ]);
    expect(
      clientOptions([
        { matterId: MATTER, personId: ANA, name: "Ana Pereira" },
        { matterId: MATTER, personId: ANA, name: "Ana Pereira" },
        { matterId: OTHER, personId: ANA, name: "Ana Pereira" },
      ]),
    ).toEqual([
      { value: ANA, label: "Ana Pereira", kind: "client", matter: MATTER },
      { value: ANA, label: "Ana Pereira", kind: "client", matter: OTHER },
    ]);
    expect(dependsOnOptions([{ id: EARLIER, title: "Agreement signed", matter_id: MATTER }, { id: "x", title: "Firm task", matter_id: null }])).toEqual([
      { value: EARLIER, label: "Agreement signed", matter: MATTER },
    ]);
  });

  it("fits owners and dependencies to the chosen matter and kind", () => {
    expect(optionFits({ kind: "internal" }, MATTER, "internal")).toBe(true);
    expect(optionFits({ kind: "internal" }, MATTER, "client")).toBe(false);
    expect(optionFits({ kind: "client", matter: MATTER }, MATTER, "client")).toBe(true);
    expect(optionFits({ kind: "client", matter: OTHER }, MATTER, "client")).toBe(false);
    expect(optionFits({ matter: OTHER }, MATTER, "internal")).toBe(false);
    expect(optionFits({}, MATTER, "internal")).toBe(true);
  });
});

describe("readNewTask", () => {
  const base = { matter: MATTER, title: "  Review   passport scan ", kind: "internal", owner: AMARA, due: "", dependsOn: "" };

  it("cleans what the dialog sends", () => {
    expect(readNewTask(base)).toEqual({
      input: { matterId: MATTER, audience: "internal", title: "Review passport scan", ownerMembershipId: AMARA, ownerPersonId: null, dueOn: null, dependsOnTaskId: null },
    });
    expect(readNewTask({ ...base, kind: "Client task (shows in their portal)", owner: ANA, due: "30/10/2026", dependsOn: EARLIER })).toEqual({
      input: { matterId: MATTER, audience: "client", title: "Review passport scan", ownerMembershipId: null, ownerPersonId: ANA, dueOn: "2026-10-30", dependsOnTaskId: EARLIER },
    });
  });

  it("asks for what is missing before calling the database", () => {
    expect(readNewTask({ ...base, matter: "" })).toEqual({ error: "Choose a matter." });
    expect(readNewTask({ ...base, title: "  " })).toEqual({ error: "Add what the task is." });
    expect(readNewTask({ ...base, title: "x".repeat(201) })).toEqual({ error: "A task title can be up to 200 characters." });
    expect(readNewTask({ ...base, kind: "someone" })).toEqual({ error: "Choose whether the task is internal or for the client." });
    expect(readNewTask({ ...base, owner: "" })).toEqual({ error: "Choose an owner." });
    expect(readNewTask({ ...base, due: "31/02/2026" })).toEqual({ error: "Enter the due date as DD/MM/YYYY." });
    expect(readNewTask({ ...base, dependsOn: "Agreement signed" })).toEqual({ error: "Choose a task it depends on, or Nothing." });
  });

  it("reads the Designer's due date format and ISO dates", () => {
    expect(dueDate("30/10/2026")).toBe("2026-10-30");
    expect(dueDate("1/2/2027")).toBe("2027-02-01");
    expect(dueDate("2026-10-30")).toBe("2026-10-30");
    expect(dueDate("29/02/2027")).toBeNull();
    expect(dueDate("10/30/2026")).toBeNull();
    expect(dueDate("soon")).toBeNull();
    expect(taskAudience("Internal (staff only)")).toBe("internal");
  });
});

describe("newTaskError", () => {
  it("says honestly why the firm refused, without passing the database message through", () => {
    expect(newTaskError("this firm is in sample mode; only sample matters accept new work")).toMatch(/still in sample mode/);
    expect(newTaskError("task create denied")).toBe("You can only add tasks to matters you’re assigned to.");
    expect(newTaskError("staff access denied")).toMatch(/role can’t create tasks/);
    expect(newTaskError("an internal task needs an active staff owner")).toMatch(/active staff member/);
    expect(newTaskError("a client task needs a person on this matter")).toMatch(/person on this matter/);
    expect(newTaskError("relation secret_table does not exist")).toBe("That action could not be completed.");
    expect(dependencyError("task dependency denied")).toMatch(/same matter/);
  });
});

describe("New task dialog markup", () => {
  const live: TasksDialogData = {
    owners: [...staffOptions([{ id: AMARA, name: "Amara Osei" }]), ...clientOptions([{ matterId: MATTER, personId: ANA, name: "Ana Pereira" }])],
    dependsOn: dependsOnOptions([{ id: EARLIER, title: "Agreement signed", matter_id: MATTER }]),
    wire: { organizationId: "org", timezone: "America/Toronto", matters: [{ value: MATTER, label: "NL-2026-0142 · Ana Pereira" }], owner: AMARA },
  };

  it("keeps the Designer's dialog and adds a Matter field in its own .fld/.sel markup", () => {
    const html = renderToStaticMarkup(createElement(TasksDialog, { data: live }));
    expect(html).toContain('<dialog class="dlg" id="dlgTask" aria-labelledby="dlgTaskH"><div class="dh"><h2 id="dlgTaskH">New task</h2>');
    expect(html).toContain(`<div class="db"><div class="fld"><label for="tkM">Matter</label><select class="sel" id="tkM"><option value="${MATTER}" selected="">NL-2026-0142 · Ana Pereira</option></select></div><div class="fld"><label for="tkT">Task</label>`);
    expect(html).toContain('<option value="internal">Internal (staff only)</option><option value="client">Client task (shows in their portal)</option>');
    expect(html).toContain(`<option value="${AMARA}" data-k="internal" selected="">Amara Osei</option><option value="${ANA}" data-k="client" data-m="${MATTER}">Ana Pereira</option>`);
    expect(html).toContain(`<option value="">Nothing</option><option value="${EARLIER}" data-m="${MATTER}">Agreement signed</option>`);
    expect(html).toContain('<div class="df"><button class="btn" data-close="dlgTask">Cancel</button><button class="btn p" data-new-task="1" data-org="org" data-tz="America/Toronto">Create</button></div>');
    expect(html).not.toContain("data-toast");
  });

  it("is the captured Designer dialog once the Matter field and the live values are taken away", () => {
    const html = renderToStaticMarkup(createElement(TasksDialog, { data: live }))
      .replace(/<div class="fld"><label for="tkM">.*?<\/select><\/div>/, "")
      .replace(/<option [^>]*>/g, "<option>")
      .replace(' data-new-task="1" data-org="org" data-tz="America/Toronto"', ' data-close="dlgTask" data-toast="Task created" data-toast-kind="ok"');
    const captured = renderToStaticMarkup(createElement(TasksMarkup, { variant: "tab-internal" }));
    const dialog = captured.slice(captured.indexOf('<dialog class="dlg" id="dlgTask"'), captured.indexOf("</dialog>") + "</dialog>".length);
    const expected = dialog
      .replace(/<select class="sel" id="tkO">.*?<\/select>/, '<select class="sel" id="tkO"><option>Amara Osei</option><option>Ana Pereira</option></select>')
      .replace(/(<select class="sel" id="tkP"><option>Nothing<\/option>).*?<\/select>/, "$1<option>Agreement signed</option></select>");
    expect(html).toBe(expected);
  });

  it("says when there is no matter to add a task to", () => {
    const html = renderToStaticMarkup(createElement(TasksDialog, { data: { ...live, wire: { ...live.wire!, matters: [] } } }));
    expect(html).toContain('<option value="" selected="">No matter you can add tasks to yet</option>');
  });
});
