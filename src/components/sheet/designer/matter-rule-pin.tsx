/**
 * SRC-05 on the matter's Overview: the rule pack and IRCC form versions pinned when the matter was
 * opened, the honest "No approved rule pack" state (SRC-12), and Review upgrade with its impact
 * preview and accept / decline. The Designer has no such panel, so it is built only from its own
 * parts, as the Decisions tab's cards are: a `.panel` with an `h2` and `.r` badge, `.li` rows with a
 * dot, `<b>` and `<small>` with `.sep` separators, the `.why` note, `.btn s sm` buttons and the
 * `.dlg wide` dialog (`.dh`, `.db`, `.fl`, `.df`). No new classes and no animation.
 */
import type { CSSProperties, ReactNode } from "react";
import type { MatterRulePinData, PinBadge } from "@/modules/sheet/rule-pin-present";
import { Icon, Sep } from "./frame";

const css = (style: Record<string, string>) => style as CSSProperties;
const DOT = { width: "8px", height: "8px", borderRadius: "50%", flex: "none" } as const;

function Pill({ badge }: { badge: PinBadge }) {
  return (
    <span className={`bd ${badge.tone}`}>
      <i></i>
      {badge.label}
    </span>
  );
}

function Parts({ parts }: { parts: ReactNode[] }) {
  const out: ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push(<Sep key={`s${index}`} />);
    out.push(<span key={`p${index}`}>{index > 0 ? " " : ""}{part}{index < parts.length - 1 ? " " : ""}</span>);
  });
  return <>{out}</>;
}

export function MatterRulePin({ data, index = 5 }: { data: MatterRulePinData; index?: number }) {
  const upgrade = data.upgrade;
  return (
    <div className={"panel rv"} style={css({ "--i": String(index), marginTop: "16px" })} id={"rulePin"}>
      <h2>
        <Icon name={"file-check"} />
        {"Rule pack and forms"}
        <span className={"r"}>
          <Pill badge={data.badge} />
        </span>
      </h2>
      <div className={"li"}>
        <i style={{ ...DOT, background: data.badge.tone === "ok" ? "#2e9d5b" : "#f0a200" }}></i>
        <div>
          <b>{data.title}</b>
          {data.parts.length ? (
            <small>
              <Parts parts={data.parts} />
            </small>
          ) : null}
        </div>
      </div>
      {data.forms.map((form) => (
        <div key={form.number} className={"li"}>
          <i style={{ ...DOT, background: "#62aef0" }}></i>
          <div>
            <b>{`Form ${form.number} (${form.modified})`}</b>
            <small>
              <Parts
                parts={[
                  ...(form.href
                    ? [
                        <a key={"u"} href={form.href} target={"_blank"} rel={"noopener noreferrer"}>
                          {"Official page"}
                        </a>,
                      ]
                    : []),
                  ...form.facts,
                ]}
              />
            </small>
          </div>
        </div>
      ))}
      {data.formsEmpty ? (
        <p className={"why"}>
          <Icon name={"info"} cls={"ic s"} />
          <span>{data.formsEmpty}</span>
        </p>
      ) : null}
      {data.note ? (
        <p className={"why"}>
          <Icon name={"info"} cls={"ic s"} />
          <span>{data.note}</span>
        </p>
      ) : null}
      {upgrade ? (
        <>
          <div className={"li"}>
            <i style={{ ...DOT, background: "#f0a200" }}></i>
            <div>
              <b>{upgrade.title}</b>
              <small>{upgrade.decision ?? upgrade.summary}</small>
            </div>
            {upgrade.open ? (
              <span className={"r"}>
                <button className={"btn s sm"} {...upgrade.open}>
                  {"Review upgrade"}
                </button>
              </span>
            ) : null}
          </div>
          {upgrade.dialog ? (
            <dialog className={"dlg wide"} id={"dPinUp"} aria-labelledby={"dPinUpT"}>
              <div className={"dh"}>
                <h2 id={"dPinUpT"}>{"Review upgrade"}</h2>
                <button className={"x"} aria-label={"Close"} data-x={""}>
                  <Icon name={"close"} />
                </button>
              </div>
              <div className={"db"}>
                <p className={"mu"} style={{ fontSize: "13px", margin: "0 0 10px" }}>
                  {upgrade.dialog.intro}
                </p>
                {upgrade.dialog.sections.map((section) => (
                  <div key={section.title} style={{ marginBottom: "10px" }}>
                    <h3>{section.title}</h3>
                    {section.items.length ? (
                      section.items.map((item, n) => (
                        <div key={n} className={"li"}>
                          <i style={{ ...DOT, background: "#62aef0" }}></i>
                          <div>
                            <small>{item}</small>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className={"mu"} style={{ fontSize: "13px", margin: "0" }}>
                        {section.empty}
                      </p>
                    )}
                  </div>
                ))}
                <label className={"fl"}>
                  {"Why (kept with the decision)"}
                  <textarea id={"pinWhy"} rows={3} />
                </label>
                <p className={"mu"} style={{ fontSize: "13px", marginTop: "8px" }}>
                  {"Accept moves this matter to the new version and asks you to confirm with your authenticator. Decline keeps it as it is. Both are recorded in the audit log."}
                </p>
              </div>
              <div className={"df"}>
                <button className={"btn"} {...upgrade.dialog.decline}>
                  {"Decline"}
                </button>
                <button className={"btn p"} {...upgrade.dialog.accept}>
                  {"Accept upgrade"}
                </button>
              </div>
            </dialog>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
