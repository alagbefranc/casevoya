import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientsHeader, SheetClients, type ClientsData } from "@/components/sheet/designer/clients";
import { SheetTasks, TaskEditDialog, TasksHeader, type TasksData } from "@/components/sheet/designer/tasks";
import { TASK_CREATE_ROLES, TASK_REASSIGN_ROLES } from "@/modules/sheet/tasks-present";

const tasks = (over: Partial<TasksData>): TasksData => ({
  tab: "internal",
  counts: { open: 0, escalated: 0 },
  dialog: { owners: [], dependsOn: [] },
  ...over,
});

describe("Tasks page", () => {
  it("offers New task only to roles create_task allows, and the owner change only to roles reassign_task allows", () => {
    expect(TASK_CREATE_ROLES).not.toContain("finance_user");
    expect(TASK_REASSIGN_ROLES).toEqual(["firm_owner", "licensed_consultant", "case_manager"]);
    expect(renderToStaticMarkup(createElement(TasksHeader, { tab: "internal", counts: { open: 2, escalated: 0 } }))).toContain("New task");
    expect(renderToStaticMarkup(createElement(TasksHeader, { tab: "internal", counts: { open: 2, escalated: 0 }, canCreate: false }))).not.toContain("New task");
    const dialog = (reassign?: boolean) => renderToStaticMarkup(createElement(TaskEditDialog, { data: { organizationId: "o", timezone: "America/Toronto", today: "2026-10-23", owners: [], reassign } }));
    expect(dialog(false)).toContain('data-reassign="0"');
    expect(dialog(true)).not.toContain("data-reassign");
  });

  it("says a tab couldn't load instead of showing it empty", () => {
    const failed = renderToStaticMarkup(createElement(SheetTasks, { data: tasks({ internal: { alert: null, rows: [], failed: true } }) }));
    expect(failed).toContain("This list couldn’t load");
    expect(failed).not.toContain("No open tasks");
    expect(renderToStaticMarkup(createElement(SheetTasks, { data: tasks({ internal: { alert: null, rows: [] } }) }))).toContain("No open tasks");
    expect(renderToStaticMarkup(createElement(SheetTasks, { data: tasks({ tab: "client", client: { rows: [], failed: true } }) }))).toContain("This list couldn’t load");
    expect(renderToStaticMarkup(createElement(SheetTasks, { data: tasks({ tab: "deadlines", deadlines: { rows: [], failed: true } }) }))).toContain("This list couldn’t load");
  });

});

const clients = (over: Partial<ClientsData>): ClientsData =>
  ({ tab: "dir", counts: { people: 0, households: 0 }, add: { href: "/sheet/matters?new=1", label: "Add a client" }, tabs: { person: "Person", household: "Household" }, ...over }) as ClientsData;

describe("Clients page", () => {
  it("says the list couldn't load instead of 'No clients yet'", () => {
    const html = renderToStaticMarkup(createElement(SheetClients, { data: clients({ dir: { copy: "", rows: [], duplicate: null, failed: true } }) }));
    expect(html).toContain("Clients couldn’t load");
    expect(html).not.toContain("No clients yet");
  });

  it("hides Add a client for a role that can't add one", () => {
    expect(renderToStaticMarkup(createElement(ClientsHeader, { data: clients({ add: null }) }))).not.toContain("Add a client");
    expect(renderToStaticMarkup(createElement(SheetClients, { data: clients({ add: null, dir: { copy: "", rows: [], duplicate: null } }) }))).not.toContain("Add a client");
  });

  it("has the hidden 'Nothing matches' panel the chips and search reveal", () => {
    const row = { href: "/sheet/clients?tab=person&person=p1", person: { name: "Ana Client" }, role: "Applicant", matter: "M-1", language: "—", timezone: "—", portal: "Not invited" };
    const html = renderToStaticMarkup(createElement(SheetClients, { data: clients({ dir: { copy: "", rows: [row as never], duplicate: null, filter: true } }) }));
    expect(html).toContain('<div class="fp-fe rv" hidden=""');
    expect(html).toContain("Nothing matches");
  });
});
