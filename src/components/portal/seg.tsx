import type { CSSProperties } from "react";

/**
 * The Designer's segmented switch (`.seg.k2-rs`) with its white thumb under the chosen option.
 * The options are equal width, so the thumb's place is plain CSS: no measuring.
 */
export function Seg<T extends string>({
  label,
  options,
  value,
  onChange,
  style,
}: {
  label: string;
  options: readonly { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
  style?: CSSProperties;
}) {
  const at = Math.max(0, options.findIndex((option) => option.key === value));
  const n = Math.max(1, options.length);
  return (
    <div className="seg k2-rs" role="radiogroup" aria-label={label} style={style}>
      <span
        className="k2-rs-th"
        aria-hidden="true"
        style={{ right: "auto", left: `calc(3px + (100% - 6px) * ${at} / ${n})`, width: `calc((100% - 6px) / ${n})` }}
      ></span>
      {options.map((option, index) => (
        <button key={option.key} type="button" role="radio" aria-checked={index === at ? "true" : "false"} tabIndex={index === at ? 0 : -1} onClick={() => onChange(option.key)}>
          {option.label}
          {option.count !== undefined ? (
            <>
              {" "}
              <span className="sep" aria-hidden="true" /> {option.count}
            </>
          ) : null}
        </button>
      ))}
    </div>
  );
}
