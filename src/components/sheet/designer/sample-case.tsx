/**
 * The Designer's sample-case panel (`section.panel.smp` in `markup/sample-mode.tsx`), rendered
 * from the firm's real sample case and its recorded sample proofs. Same DOM, classes and copy.
 */
import { Icon, Sep } from "./frame";
import { GoLiveSwitch } from "./go-live-switch";
import { SampleStepCheck } from "./sample-step-check";

export type SampleStep = {
  key: string;
  image: string;
  title: string;
  note: string;
  href: string;
  done: boolean;
};

export type SampleCaseData = {
  /** "Priya" in "Try the six key steps on Priya’s sample case". */
  applicant: string;
  steps: SampleStep[];
  /** Who the licence check is for and where it stands ("waiting for review"). */
  licence: { holder: string; status: string } | null;
  /** Live addition: the go-live checklist and Switch to live. Absent for a live firm. */
  live?: GoLiveData | null;
  /**
   * The firm is live (firms start live since 2026-10-19) and is taking the optional tour: the
   * footer says real client invitations are open instead of locked. Same DOM and classes.
   */
  firmLive?: boolean;
};

/**
 * Copy changed from the Designer capture (decision 2026-10-19: the six steps are an optional tour
 * and a declared licence is enough to invite real clients). Text only; the DOM is the capture's.
 */
export const SAMPLE_COPY = {
  /** Designer: "When they’re done and your licence check passes, you can invite real clients." */
  lead: "Optional practice on fictional records. Real client invitations need only your CICC licence on file and the firm switched to live.",
  leadLive: "Optional practice on fictional records. Your firm is live, so you can invite real clients any time.",
  /** Designer: "N sample steps left". */
  left: (left: number) => `${left} practice ${left === 1 ? "step" : "steps"} left, optional `,
  /** Designer: "Opens after verification". */
  why: "Opens when the firm switches to live",
  whyLive: "Your firm is live",
  lockedLive: "Real client invitations are open",
} as const;

/**
 * Live addition (no Designer screen; approved by Francis 2026-10-19). What keeps a sample-mode
 * firm's real client invitations locked (the owner's CICC licence, and an ended trial), as more of
 * the Designer's `.smp-i` step tiles in a second `.smp-g` row, and the firm owner's Switch to live.
 */
export type GoLiveData = {
  licence: {
    /** The firm owner's licence is on file. */
    added: boolean;
    /** It is revoked, suspended, inactive or not entitled, so it keeps invitations locked. */
    blocked: boolean;
    /** Where the latest check stands in the panel's words ("declared", "needs review", "verified"); null without a licence. */
    status: string | null;
  };
  trialEnded: boolean;
  /** Plain words for everything still blocking, in order. Empty when the firm can go live. */
  remaining: string[];
  /** Only the firm owner switches the firm to live. */
  owner: boolean;
};

const B2 = "/assets/generated/b2";

function GoLiveTile({ art, title, note, href, go, done }: { art: string; title: string; note: string; href: string; go: string; done: boolean }) {
  return (
    <div className={done ? "smp-i d k2-spot" : "smp-i k2-spot"} data-spot={"1"}>
      <div className={"smp-il"}>
        <img src={`${B2}/${art}-72@1x.webp`} srcSet={`${B2}/${art}-72@2x.webp 2x`} width={64} height={64} alt={""} loading={"lazy"} />
      </div>
      <span>
        <a href={href}>{title}</a>
        <small>{note}</small>
      </span>
      {done ? (
        <span className={"bd ok"}>
          <i></i>
          {"Done"}
        </span>
      ) : (
        <a className={"go"} href={href}>
          {`${go} `}
          <Icon name={"arrow-right"} cls={"ic s"} />
        </a>
      )}
    </div>
  );
}

/** The go-live steps row, placed under the six sample steps. */
export function GoLiveSteps({ data }: { data: GoLiveData }) {
  const { licence } = data;
  const note = !licence.added
    ? "Your licence number from the CICC register"
    : licence.blocked
      ? `Licence check: ${licence.status ?? "needs attention"}`
      : "On file. The number is checked against the CICC register list.";
  return (
    <div className={"smp-g"} data-golive={"steps"}>
      <GoLiveTile
        art={licence.blocked ? "licence-paused" : "licence-card"}
        title={licence.blocked ? "Your CICC licence needs attention" : "Add your CICC licence"}
        note={note}
        href={"/sheet/licence"}
        go={licence.blocked ? "Review it" : "Add it"}
        done={licence.added && !licence.blocked}
      />
      {data.trialEnded ? (
        <GoLiveTile art={"invoice-plain"} title={"Your trial has ended"} note={"Choose a plan to keep going"} href={"/sheet/settings?tab=billing"} go={"Choose a plan"} done={false} />
      ) : null}
    </div>
  );
}

function VoPointing() {
  return (
    <div className={"smp-vo"}>
      <svg className={"mascot vo-pose p-point"} width={64} height={64} viewBox={"0 0 100 100"} role={"img"} aria-label={"Vo pointing to the next step"} style={{ overflow: "visible" }}>
        <g className={"m-body"} style={{ transformOrigin: "50px 90px" }} transform={""}>
          <path d={"M38 20 C 42 28, 46 32, 50 31 C 55 26, 60 18, 68 14"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
          <ellipse cx={"50"} cy={"60"} rx={"32"} ry={"30"} fill={"#0075DE"} />
          <ellipse cx={"50"} cy={"64"} rx={"21"} ry={"17"} fill={"#fff"} />
          <ellipse cx={"42"} cy={"60"} rx={"3.4"} ry={"3.9"} fill={"#111"} />
          <ellipse cx={"58"} cy={"60"} rx={"3.4"} ry={"3.9"} fill={"#111"} />
          <circle cx={"43.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
          <circle cx={"59.1"} cy={"58.7"} r={"1"} fill={"#fff"} />
          <path d={"M45 70 q5 4 10 0"} fill={"none"} stroke={"#111"} strokeWidth={"2.2"} strokeLinecap={"round"} />
          <ellipse cx={"34"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
          <ellipse cx={"66"} cy={"70"} rx={"3.4"} ry={"2"} fill={"#62aef0"} opacity={".7"} />
        </g>
        <path className={""} d={"M80 62 q12 -2 18 -10"} fill={"none"} stroke={"#0075DE"} strokeWidth={"7"} strokeLinecap={"round"} />
        <circle cx={"99"} cy={"51"} r={"3"} fill={"#0075DE"} />
      </svg>
    </div>
  );
}

/** The Designer's rolling counter: the digit strip is moved up by the count. */
function Counter({ value }: { value: number }) {
  return (
    <b className={"num k2-count"} id={"smpC"} data-len={"1"}>
      <span className={"k2-dg"}>
        <span className={"k2-st"} style={{ transform: `translateY(-${value}em)` }}>
          {["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <span key={digit}>{digit}</span>
          ))}
        </span>
      </span>
      <span className={"k2-sr"}>{String(value)}</span>
    </b>
  );
}

function Step({ step }: { step: SampleStep }) {
  return (
    <div className={step.done ? "smp-i d k2-spot" : "smp-i k2-spot"} data-spot={"1"}>
      <div className={"smp-il"}>
        <img src={`/assets/generated/steps/b/${step.image}@1x.webp`} srcSet={`/assets/generated/steps/b/${step.image}@2x.webp 2x`} width={64} height={64} alt={""} loading={"lazy"} />
        <label className={"smp-ck"}>
          <SampleStepCheck step={step.key} done={step.done} label={`Mark “${step.title}” done`} />
        </label>
      </div>
      <span>
        <a href={step.href}>{step.title}</a>
        <small>{step.note}</small>
      </span>
      {step.done ? (
        <span className={"bd ok"}>
          <i></i>
          {"Done"}
        </span>
      ) : (
        <a className={"go"} href={step.href}>
          {"Try it "}
          <Icon name={"arrow-right"} cls={"ic s"} />
        </a>
      )}
    </div>
  );
}

export function SampleCasePanel({ data }: { data: SampleCaseData }) {
  const done = data.steps.filter((step) => step.done).length;
  const left = data.steps.length - done;
  return (
    <section className={"panel smp rv"} aria-labelledby={"smpH"} style={{ "--i": "1" } as React.CSSProperties}>
      <div className={"smp-hd"}>
        <VoPointing />
        <div>
          <span className={"bd blue"}>
            <i></i>
            {"Sample data"}
          </span>
          <h2 id={"smpH"}>{`Try the six key steps on ${data.applicant}’s sample case`}</h2>
          <p>{data.firmLive ? SAMPLE_COPY.leadLive : SAMPLE_COPY.lead}</p>
        </div>
        <div className={"smp-n"}>
          <Counter value={done} />
          <small>{`of ${data.steps.length} done`}</small>
        </div>
      </div>
      <div className={"prog"} style={{ "--v": `${(done / data.steps.length) * 100}%`, margin: "0 22px" } as React.CSSProperties}>
        <i></i>
      </div>
      <div className={"smp-g"}>
        {data.steps.map((step) => (
          <Step key={step.key} step={step} />
        ))}
      </div>
      {data.live ? <GoLiveSteps data={data.live} /> : null}
      <div className={"smp-f"}>
        <div className={"alert lockd"} style={{ margin: "0", flex: "1", alignItems: "center" }}>
          <span className={"art"} style={{ "--a": "36px" } as React.CSSProperties} aria-hidden={"true"}>
            <img src={"/assets/generated/b2/sandbox-160@1x.webp"} srcSet={"/assets/generated/b2/sandbox-160@2x.webp 2x"} width={36} height={36} alt={""} loading={"lazy"} decoding={"async"} />
          </span>
          <div>
            <b>{data.firmLive ? SAMPLE_COPY.lockedLive : "Real client invitations are locked"}</b>
            {SAMPLE_COPY.left(left)}
            <Sep />
            {data.licence ? (
              <>
                {` licence check for ${data.licence.holder}: `}
                <a className={"tl"} href={"/sheet/licence"}>
                  {data.licence.status}
                </a>
              </>
            ) : (
              <>
                {" licence: "}
                <a className={"tl"} href={"/setup?step=3"}>
                  {"add your licence"}
                </a>
              </>
            )}
          </div>
        </div>
        <div>
          {data.firmLive ? (
            <a className={"btn p"} href={"/sheet/invitations?tab=clients"} aria-describedby={"whyInv"}>
              <Icon name={"user-plus"} cls={"ic s"} />
              {"Invite a real client"}
            </a>
          ) : (
            <button className={"btn p"} aria-disabled={"true"} aria-describedby={"whyInv"}>
              <Icon name={"user-plus"} cls={"ic s"} />
              {"Invite a real client"}
            </button>
          )}
          <p className={"why"} id={"whyInv"}>
            <Icon name={data.firmLive ? "check-circle" : "lock"} cls={"ic s"} />
            {data.firmLive ? SAMPLE_COPY.whyLive : SAMPLE_COPY.why}
          </p>
        </div>
        {data.live ? <GoLiveSwitch data={data.live} /> : null}
      </div>
    </section>
  );
}
