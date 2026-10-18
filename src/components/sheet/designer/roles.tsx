/**
 * The Designer's Roles and permissions page (`markup/roles.tsx`), rendered from a permission
 * matrix passed in as data. Same DOM, classes and order as the capture. The live page passes
 * `ROLE_MATRIX` from `src/modules/staff/role-matrix.ts`, which states what the server enforces.
 */
import { Icon } from "./frame";

/** The page's own stylesheet, placed after the frame's wave style in the capture. */
export const ROLES_CSS =
  ".rl th{white-space:normal;vertical-align:bottom;font-size:13px;min-width:84px}.rl td{font-size:14px}.yes{display:inline-flex;gap:3px;align-items:center;color:var(--blue)}.no{color:var(--t2)}";

/** One cell: Yes, No, or a tinted badge ("Assigned only", "Own", "Support grant"). */
export type RoleCell = "yes" | "no" | { tone: "rev" | "gr" | "chg"; label: string };

export type RoleMatrixData = {
  /** Column headings after "Permission". */
  roles: string[];
  rows: { permission: string; cells: RoleCell[] }[];
  /** The intro paragraph under the heading. */
  intro: string;
  /** The two notes under the table. */
  notes: { lock: string; shield: string };
  /** Pills after the crumb ("10 roles", "Changes are logged"). */
  pills: string[];
};

function i(n: number, extra: React.CSSProperties = {}) {
  return { ...extra, "--i": String(n) } as React.CSSProperties;
}

function Cell({ cell }: { cell: RoleCell }) {
  if (cell === "yes") {
    return (
      <span className={"yes"}>
        <Icon name={"check-circle"} cls={"ic s"} />
        {"Yes"}
      </span>
    );
  }
  if (cell === "no") return <span className={"no"}>{"No"}</span>;
  return (
    <span className={`bd ${cell.tone}`}>
      <i></i>
      {cell.label}
    </span>
  );
}

export function RolesHeader({ pills }: { pills: string[] }) {
  return (
    <header className={"top"}>
      <button className={"crumb"}>
        <Icon name={"settings"} cls={"ic s"} />
        {"Settings"}
        <Icon name={"sort"} cls={"ic dd"} />
      </button>
      <span className={"cs"} aria-hidden={"true"}>
        {"/"}
      </span>
      <button className={"crumb"}>
        <Icon name={"shield"} cls={"ic s"} />
        {"Roles and permissions"}
      </button>
      {pills.map((pill) => (
        <span key={pill} className={"pill"}>
          {pill}
        </span>
      ))}
      <span className={"acts"}></span>
    </header>
  );
}

export function SheetRoles({ data }: { data: RoleMatrixData }) {
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <h1 className={"display"}>{"Roles and permissions"}</h1>
        <p>{data.intro}</p>
      </div>
      <div className={"tw rv"} tabIndex={0} role={"region"} aria-label={"Table, scroll sideways"} style={i(1)}>
        <table className={"t rl"}>
          <thead>
            <tr>
              <th>{"Permission"}</th>
              {data.roles.map((role) => (
                <th key={role}>{role}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.permission}>
                <td>{row.permission}</td>
                {row.cells.map((cell, index) => (
                  <td key={index}>
                    <Cell cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={"lock rv"} style={i(2, { marginTop: "18px", fontSize: "13.5px" })}>
        <Icon name={"lock"} cls={"ic s"} />
        {data.notes.lock}
      </div>
      <div className={"lock rv"} style={i(3, { marginTop: "10px", fontSize: "13.5px" })}>
        <Icon name={"shield"} cls={"ic s"} />
        {data.notes.shield}
      </div>
    </>
  );
}
