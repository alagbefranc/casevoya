// True when a migration would remove data or structure as it runs.
// Statements inside dollar-quoted function bodies only run later, when the function
// is called, so they are skipped here; a top-level DROP, TRUNCATE or DELETE is not.
// Only statement starts count, so a protective `before truncate` trigger is not a hit.
export function isDestructive(sql) {
  const topLevel = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''");
  return topLevel.split(";").some((statement) => {
    const text = statement.trim().toLowerCase().replace(/\s+/g, " ");
    return (
      /^(drop table|drop schema|truncate|delete from)\b/.test(text) ||
      /^alter table\b.*\bdrop column\b/.test(text)
    );
  });
}
