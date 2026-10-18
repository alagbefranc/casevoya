/**
 * The Designer's Intake form builder (`markup/intake-builder.tsx`), Build and Preview tabs, with
 * its Field settings column. Same DOM, classes and order; the fields come from the firm's
 * versioned intake form (intake_templates). The Preview tab is captured with the same content.
 *
 * Live-only additions are data attributes read by the browser builder (intake-builder-acts):
 * `data-intake-*` on #qs (the form, its draft version and its schema), `data-key` on each field
 * row, `data-type` on each field type, `data-intake-publish` on Publish and
 * `data-goto-tab="preview"` on Preview.
 */
import { Icon, Pair, VoCard } from "./frame";

export const INTAKE_BUILDER_CSS = ".ib{display:grid;grid-template-columns:200px 1fr;gap:16px}.ft{display:flex;gap:10px;align-items:center;padding:9px 6px;font-size:14px;border-radius:8px;cursor:grab}.ft:hover{background:var(--canvas)}.ft .ic{color:#8b8680}\n.qq{display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:10px;background:var(--canvas);margin-bottom:8px;cursor:pointer;transition:box-shadow var(--fast),background var(--fast)}.qq b{font-weight:500;font-size:14.5px}.qq small{display:block;color:var(--t2);font-size:13px}.qq .ic{color:#8b8680}.qq .btn{background:#fff}\n.qq.on{box-shadow:inset 0 0 0 1.5px #8fc4f5;background:#fff}.qq.ind{margin-left:16px;border-left:3px solid var(--blue)}@media(max-width:900px){.ib{grid-template-columns:1fr}}";

export type IntakeTab = "build" | "preview";

export type IntakeRow = {
  key?: string;
  label: string;
  typeLabel: string;
  note: string;
  conditional: boolean;
  badge: { tone: "gr" | "blue"; label: string } | null;
  selected: boolean;
};

export type IntakeBuilderData = {
  tab: IntakeTab;
  title: string;
  pills: (string | { left: string; right: string })[];
  publishLabel: string;
  section: { left: string; right: string };
  palette: { label: string; type?: string }[];
  rows: IntakeRow[];
  settings: { label: string; toggles: { label: string; on: boolean }[] };
  vo: { draft: string; sources: string } | null;
  /** Present on a real page. */
  live?: {
    organizationId: string;
    stableKey: string;
    title: string;
    templateId: string | null;
    version: number | null;
    status: "draft" | "published" | "new";
    schema: string;
  };
};

function i(n: number) {
  return { "--i": String(n) } as React.CSSProperties;
}

export function IntakeHeader({ data }: { data: IntakeBuilderData }) {
  return (
    <>
      <header className={"top"}>
        <button className={"crumb"}>
          <Icon name={"file"} cls={"ic s"} />
          {"Intake forms"}
          <Icon name={"sort"} cls={"ic dd"} />
        </button>
        <span className={"cs"} aria-hidden={"true"}>
          {"/"}
        </span>
        <button className={"crumb"}>
          <Icon name={"file"} cls={"ic s"} />
          {data.title}
        </button>
        {data.pills.map((pill, index) =>
          typeof pill === "string" ? (
            <span key={index} className={"pill"}>
              {pill}
            </span>
          ) : (
            <span key={index} className={"pill"}>
              <span>
                <Pair left={pill.left} right={pill.right} />
              </span>
            </span>
          ),
        )}
        <span className={"acts"}>
          <button className={"btn s sm"} data-goto-tab={data.live ? "preview" : undefined}>
            <Icon name={"eye"} cls={"ic s"} />
            {"Preview"}
          </button>
          <button className={"btn p sm"} data-intake-publish={data.live ? "1" : undefined}>
            {data.publishLabel}
          </button>
        </span>
      </header>
      <div className={"tabs"} role={"tablist"}>
        <button role={"tab"} data-t={"build"} className={data.tab === "build" ? "on" : undefined}>
          {"Build"}
        </button>
        <button role={"tab"} data-t={"preview"} className={data.tab === "preview" ? "on" : undefined}>
          {"Preview"}
        </button>
        <i className={"ul"} style={data.tab === "build" ? { left: "0px", width: "32px" } : { left: "58px", width: "48px" }}></i>
      </div>
    </>
  );
}

function Row({ row }: { row: IntakeRow }) {
  const cls = ["qq", row.selected ? "on" : "", row.conditional ? "ind" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} data-key={row.key}>
      <Icon name={row.conditional ? "workflow" : "menu"} cls={"ic s"} />
      <div style={{ flex: "1" }}>
        <b>{row.label}</b>
        <small>
          <Pair left={row.typeLabel} right={row.note} />
        </small>
      </div>
      {row.badge ? (
        <span className={`bd ${row.badge.tone}`}>
          <i></i>
          {row.badge.label}
        </span>
      ) : null}
      <button className={"btn s sm"} aria-label={`Edit ${row.label}`} style={{ width: "34px", padding: "0" }}>
        <Icon name={"edit"} cls={"ic s"} />
      </button>
    </div>
  );
}

export function SheetIntakeBuilder({ data }: { data: IntakeBuilderData }) {
  const live = data.live;
  return (
    <>
      <div className={"ph rv"} style={i(0)}>
        <h1 className={"display"}>{"Intake form builder"}</h1>
        <p>{"Answers autosave as the client types. Every answer keeps its source, whether the client, a sponsor, staff or OCR."}</p>
      </div>
      <div className={"ib rv"} style={i(1)}>
        <div className={"panel"} style={{ margin: "0" }}>
          <h2 style={{ border: "0" }}>
            <Icon name={"plus"} />
            {"Field types"}
          </h2>
          <div className={"pad"} style={{ paddingTop: "0" }}>
            {data.palette.map((item) => (
              <div key={item.label} className={"ft"} draggable={"true"} data-type={item.type}>
                <Icon name={"menu"} cls={"ic s"} />
                {item.label}
              </div>
            ))}
          </div>
        </div>
        <div className={"panel"} style={{ margin: "0" }}>
          <h2 style={{ border: "0" }}>
            <Icon name={"file"} />
            <span>
              <Pair left={data.section.left} right={data.section.right} />
            </span>
          </h2>
          <div
            className={"pad"}
            style={{ paddingTop: "0" }}
            id={"qs"}
            data-intake-org={live?.organizationId}
            data-intake-key={live?.stableKey}
            data-intake-title={live?.title}
            data-intake-id={live ? (live.templateId ?? "") : undefined}
            data-intake-version={live ? String(live.version ?? "") : undefined}
            data-intake-status={live?.status}
            data-intake-schema={live?.schema}
          >
            {data.rows.map((row, index) => (
              <Row key={row.key ?? index} row={row} />
            ))}
            <button className={"btn s"} style={{ width: "100%", justifyContent: "flex-start" }} id={"addq"}>
              <Icon name={"plus"} cls={"ic s"} />
              {"Add field"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const LABEL_INPUT: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: "6px",
  height: "42px",
  border: "1px solid #d9d5d0",
  borderRadius: "8px",
  padding: "0 12px",
  background: "#fff",
};

/** The Field settings column, in place of the calendar column. */
export function IntakeSettings({ data }: { data: IntakeBuilderData }) {
  return (
    <aside id={"rbar"} aria-label={"Details"}>
      <h4>{"Field settings"}</h4>
      <label style={{ fontSize: "14px", fontWeight: "500" }}>
        {"Label"}
        <input key={data.settings.label} defaultValue={data.settings.label} style={LABEL_INPUT} />
      </label>
      <div className={"rank"} style={{ marginTop: "12px", fontSize: "14px" }}>
        {data.settings.toggles.map((toggle) => (
          <div key={toggle.label} style={{ padding: "8px 2px" }}>
            {toggle.label}
            <span className={toggle.on ? "tog on" : "tog"} style={{ marginLeft: "auto" }}></span>
          </div>
        ))}
      </div>
      <h4>{"Provenance"}</h4>
      <p style={{ fontSize: "13px", color: "var(--t2)" }}>{"Each answer records who gave it and when. OCR answers stay tentative until staff confirm them."}</p>
      {data.vo ? <VoCard draft={data.vo.draft} sources={data.vo.sources} marginTop={"12px"} /> : null}
    </aside>
  );
}
