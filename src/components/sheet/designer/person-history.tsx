/**
 * Live only (INT-05; the Designer's People tab has no identity history): for each client on the
 * matter, their other names, passports and addresses, and the review flags on them. Built from the
 * Designer's parts: `.panel` with an `h2`, `.sub` headings, `.tw` / `.t` tables, `.bd` badges,
 * `.fld` / `.inp` / `.sel` fields and `.btn s sm`. Adding opens a `details` form under each table
 * (`data-ph-add`); Remove (`data-ph-remove`) and Resolve (`data-ph-resolve`) are wired in
 * person-history-acts. Nothing is overwritten: a removed entry stays on record.
 */
import { Fragment } from "react";
import { ISO_COUNTRY_CODES } from "@/lib/iso-country";
import { countryName } from "@/modules/intake/present";
import { NAME_KINDS, type PersonHistoryPanel, type PersonHistoryRow } from "@/modules/sheet/person-history-present";
import { Icon } from "./frame";

const COUNTRIES = [...ISO_COUNTRY_CODES].map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));

function Countries({ id, name, optional }: { id: string; name: string; optional?: boolean }) {
  return (
    <select className={"sel"} id={id} name={name} defaultValue={""}>
      <option value={""}>{optional ? "Not given" : "Choose a country"}</option>
      {COUNTRIES.map((country) => (
        <option key={country.code} value={country.code}>
          {country.name}
        </option>
      ))}
    </select>
  );
}

/** The Designer's `.fld`: a label, an optional hint, then the control (`render` gets its id). */
function Fld({ id, label, hint, render }: { id: string; label: string; hint?: string; render: (id: string) => React.ReactNode }) {
  return (
    <div className={"fld"}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <small className={"hint"} id={`${id}-h`}>
          {hint}
        </small>
      ) : null}
      {render(id)}
    </div>
  );
}

const fid = (panel: PersonHistoryPanel, field: string) => `ph-${panel.personId}-${field}`;

function Table({ panel, kind, head, rows, empty }: { panel: PersonHistoryPanel; kind: string; head: string[]; rows: PersonHistoryRow[]; empty: string }) {
  if (rows.length === 0) return <p className={"mu ph-empty"}>{empty}</p>;
  return (
    <div className={"tw"}>
      <table className={"t"}>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={cell} {...(index === 0 ? { style: { paddingLeft: "18px" } } : {})}>
                {cell}
              </th>
            ))}
            <th>{"Added"}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {row.cells.map((cell, index) => (
                <td key={index} {...(index === 0 ? { style: { paddingLeft: "18px" } } : {})} {...(cell.startsWith("••••") ? { className: "num" } : {})}>
                  {cell}
                </td>
              ))}
              {row.badge !== undefined ? (
                <td>
                  {row.badge ? (
                    <span className={`bd ${row.badge.tone}`}>
                      <i></i>
                      {row.badge.label}
                    </span>
                  ) : null}
                </td>
              ) : null}
              <td className={"mu"}>{row.added}</td>
              <td>
                {panel.edit ? (
                  <button className={"btn s sm"} type={"button"} data-ph-remove={row.id} data-kind={kind} data-person={panel.personId} data-org={panel.organizationId}>
                    {"Remove"}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddForm({ panel, kind, label, children }: { panel: PersonHistoryPanel; kind: string; label: string; children: React.ReactNode }) {
  if (!panel.edit) return null;
  return (
    <details className={"phx"}>
      <summary className={"btn s sm"}>
        <Icon name={"plus"} cls={"ic s"} />
        {label}
      </summary>
      <div className={"g2"}>{children}</div>
      <button className={"btn p sm"} type={"button"} data-ph-add={kind} data-person={panel.personId} data-org={panel.organizationId}>
        {"Save"}
      </button>
    </details>
  );
}

export function PersonHistory({ panel, index }: { panel: PersonHistoryPanel; index: number }) {
  return (
    <div className={"panel rv ph"} style={{ "--i": String(index) } as React.CSSProperties}>
      <h2>
        <Icon name={"id-card"} />
        <span>{`${panel.name}: names, passports and addresses`}</span>
        <span className={"r"}>
          {panel.flags.length ? (
            <span className={"bd chg"}>
              <i></i>
              {`${panel.flags.length} to check`}
            </span>
          ) : (
            <span className={"bd ok"}>
              <i></i>
              {"No flags"}
            </span>
          )}
        </span>
      </h2>

      {panel.flags.length || panel.resolved.length ? (
        <>
          <h3 className={"sub"}>{"Review flags"}</h3>
          <ul className={"phf"}>
            {panel.flags.map((flag) => (
              <li key={flag.key}>
                <span className={"bd chg"}>
                  <i></i>
                  {flag.label}
                </span>
                <span>{flag.detail}</span>
                {panel.resolve ? (
                  <details className={"phx"}>
                    <summary className={"btn s sm"}>{"Resolve"}</summary>
                    <Fld id={fid(panel, `flag-${flag.key}`)} label={"Why this is fine"} hint={"Kept with the flag and in the audit log."} render={(id) => (
          <textarea id={id} className={"ta"} name={"note"} maxLength={1000}></textarea>
        )} />
                    <button className={"btn p sm"} type={"button"} data-ph-resolve={flag.key} data-detail={flag.detail} data-person={panel.personId} data-org={panel.organizationId}>
                      {"Resolve flag"}
                    </button>
                  </details>
                ) : null}
              </li>
            ))}
            {panel.resolved.map((done, at) => (
              <li key={`done-${at}`}>
                <span className={"bd ok"}>
                  <i></i>
                  {"Resolved"}
                </span>
                <span>
                  {done.detail}
                  <small className={"mu"}>{`“${done.note}”, ${done.by}`}</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className={"sub"}>{"Other names"}</h3>
      <Table panel={panel} kind={"name"} head={["Name", "Kind", "Script"]} rows={panel.names} empty={"No other names recorded."} />
      <AddForm panel={panel} kind={"name"} label={"Add a name"}>
        <Fld id={fid(panel, "name-name_kind")} label={"Kind"} render={(id) => (
          <select id={id} className={"sel"} name={"name_kind"} defaultValue={"alias"}>
            {NAME_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        )} />
        <Fld id={fid(panel, "name-name")} label={"Name"} render={(id) => (
          <input id={id} className={"inp"} name={"name"} maxLength={200} />
        )} />
        <Fld id={fid(panel, "name-script")} label={"Script"} hint={"For a transliteration: the script it’s written in, like Cyrillic."} render={(id) => (
          <input id={id} className={"inp"} name={"script"} maxLength={60} />
        )} />
      </AddForm>

      <h3 className={"sub"}>{"Passports"}</h3>
      <Table panel={panel} kind={"passport"} head={["Country", "Number", "Issued", "Expires", "State"]} rows={panel.passports} empty={"No passports recorded."} />
      <AddForm panel={panel} kind={"passport"} label={"Add a passport"}>
        <Fld id={fid(panel, "passport-country")} label={"Country"} render={(id) => (
          <Countries id={id} name={"country"} />
        )} />
        <Fld id={fid(panel, "passport-number")} label={"Number"} hint={"Shown masked on this page."} render={(id) => (
          <input id={id} className={"inp"} name={"number"} maxLength={24} autoComplete={"off"} />
        )} />
        <Fld id={fid(panel, "passport-name")} label={"Name as printed"} hint={"Optional. Checked against their record and other names."} render={(id) => (
          <input id={id} className={"inp"} name={"name"} maxLength={200} />
        )} />
        <Fld id={fid(panel, "passport-birth_date")} label={"Date of birth as printed"} hint={"Optional."} render={(id) => (
          <input id={id} className={"inp"} name={"birth_date"} type={"date"} />
        )} />
        <Fld id={fid(panel, "passport-issued_on")} label={"Issued on"} hint={"Optional."} render={(id) => (
          <input id={id} className={"inp"} name={"issued_on"} type={"date"} />
        )} />
        <Fld id={fid(panel, "passport-expires_on")} label={"Expires on"} hint={"The date printed on the passport."} render={(id) => (
          <input id={id} className={"inp"} name={"expires_on"} type={"date"} />
        )} />
        <label className={"check"}>
          <input type={"checkbox"} name={"current"} />
          <span>{"Their current passport"}</span>
        </label>
      </AddForm>

      <h3 className={"sub"}>{"Addresses"}</h3>
      <Table panel={panel} kind={"address"} head={["Address", "From", "To"]} rows={panel.addresses} empty={"No address history recorded."} />
      <AddForm panel={panel} kind={"address"} label={"Add an address"}>
        <Fld id={fid(panel, "address-address")} label={"Address"} render={(id) => (
          <input id={id} className={"inp"} name={"address"} maxLength={500} placeholder={"Street, city, province or state, postal code"} />
        )} />
        <Fld id={fid(panel, "address-country")} label={"Country"} render={(id) => (
          <Countries id={id} name={"country"} optional />
        )} />
        <Fld id={fid(panel, "address-from_on")} label={"From"} render={(id) => (
          <input id={id} className={"inp"} name={"from_on"} type={"date"} />
        )} />
        <Fld id={fid(panel, "address-to_on")} label={"To"} hint={"Leave empty if they still live there."} render={(id) => (
          <input id={id} className={"inp"} name={"to_on"} type={"date"} />
        )} />
      </AddForm>

      <p className={"note"}>
        <Icon name={"history"} cls={"ic s"} />
        {`Nothing is overwritten: a changed or removed entry stays on record${panel.earlier ? ` (${panel.earlier} earlier)` : ""}. Flags are things to check, never a finding of fraud.`}
      </p>
    </div>
  );
}

export function PersonHistoryList({ panels }: { panels: PersonHistoryPanel[] }) {
  return (
    <>
      {panels.map((panel, index) => (
        <Fragment key={panel.personId}>
          <PersonHistory panel={panel} index={index + 3} />
        </Fragment>
      ))}
    </>
  );
}
