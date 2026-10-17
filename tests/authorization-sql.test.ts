import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const personsSql = readFileSync(
  path.resolve(import.meta.dirname, "../supabase/migrations/20261017160200_persons_matters_grants.sql"),
  "utf8",
);

function functionBody(sql: string, name: string): string {
  const marker = `create function ${name}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const next = sql.indexOf("\ncreate function ", start + marker.length);
  return sql.slice(start, next === -1 ? undefined : next);
}

describe("person authorization does not consult household or payer links", () => {
  it("can_read_person and grant_allows ignore household and relationship tables", () => {
    for (const name of ["app.can_read_person", "app.grant_allows", "app.can_read_matter"]) {
      const body = functionBody(personsSql, name);
      expect(body).not.toMatch(/household/i);
      expect(body).not.toMatch(/person_relationships/);
      expect(body).not.toMatch(/payer/);
    }
    expect(functionBody(personsSql, "app.grant_allows")).toMatch(/guardian/);
    expect(functionBody(personsSql, "app.grant_allows")).toMatch(/is_minor/);
    const assigned = functionBody(personsSql, "app.actor_staff_assigned_to_matter");
    expect(assigned).toContain("assistant");
    expect(assigned).not.toContain("finance_user");
  });
});
