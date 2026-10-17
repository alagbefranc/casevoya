import { sheetVariant, type SheetQuery } from "@/modules/sheet/present";
import { SHEET_MARKUP } from "./markup/registry";

export function DemoSheet({ page, query }: { page: string; query: SheetQuery }) {
  const Markup = SHEET_MARKUP[page];
  if (!Markup) return null;
  return <Markup variant={sheetVariant(page, query)} />;
}
