import { Empty } from "./frame";

/**
 * Live only: the Tasks page's hidden "Nothing matches" panel (`.fp-fe`, the Designer's own), shown
 * by use-sheet when a page's chips and search leave no row; its button clears them. Pages render it
 * right after their table, as a direct child of `#content`.
 */
export function FilterEmpty({ n }: { n: number }) {
  return (
    <div className={"fp-fe rv"} hidden style={{ "--i": String(n) } as React.CSSProperties}>
      <Empty art={"filter-empty"} title={"Nothing matches"} copy={"Try another filter or clear the search."}>
        <button className={"btn s sm"} type={"button"}>
          {"Clear filters"}
        </button>
      </Empty>
    </div>
  );
}
