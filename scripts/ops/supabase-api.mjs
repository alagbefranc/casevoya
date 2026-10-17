// Shared helper for the ops scripts. Talks to the Supabase Management API with
// SUPABASE_ACCESS_TOKEN from the environment. Never prints the token.
export const PROJECT_REF = "aqjtvqmojfamtspzyeqm";

export async function runSql(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is not set.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase API ${response.status}: ${text.slice(0, 2000)}`);
  return text ? JSON.parse(text) : [];
}
