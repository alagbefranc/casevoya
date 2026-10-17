import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isDestructive } from "../scripts/ops/destructive.mjs";

describe("apply-migration destructive guard", () => {
  it.each([
    "drop table public.persons;",
    "truncate public.inbound_emails;",
    "delete from public.matters where true;",
    "alter table public.persons drop column email;",
    "drop schema app cascade;",
  ])("refuses top-level %s", (sql) => {
    expect(isDestructive(sql)).toBe(true);
  });

  it("ignores statements inside function bodies and comments", () => {
    const sql = `
      -- delete from public.matters (just a comment)
      create function app.f() returns void language plpgsql as $$
      begin
        delete from app.document_download_grants where expires_at < now();
      end;
      $$;
      create function app.g() returns void language sql as $body$ truncate app.x $body$;
    `;
    expect(isDestructive(sql)).toBe(false);
  });

  it("still catches a top-level delete next to a function", () => {
    expect(isDestructive("create function app.f() returns int language sql as $$ select 1 $$;\ndelete from public.persons;")).toBe(true);
  });

  it("lets the download-grants migration through", () => {
    const sql = readFileSync("supabase/migrations/20261018010400_document_download_grants.sql", "utf8");
    expect(isDestructive(sql)).toBe(false);
  });
});

describe("apply-migration destructive guard on protective statements", () => {
  it("does not flag a trigger that blocks truncation", () => {
    expect(isDestructive("create trigger t_no_truncate before truncate on public.audit_log for each statement execute function app.f();")).toBe(false);
  });

  it("passes every committed migration", () => {
    const dir = "supabase/migrations";
    const flagged = readdirSync(dir).filter((file) => isDestructive(readFileSync(`${dir}/${file}`, "utf8")));
    expect(flagged).toEqual([]);
  });
});
