export type ServiceNoticeOptions = {
  by?: string;
  kind?: string;
  severity?: string;
  title?: string;
  body?: string;
  starts?: string;
  ends?: string;
  note?: string;
  firms: string[];
  allFirms: boolean;
  draft: boolean;
  publish: boolean;
  dryRun: boolean;
  all: boolean;
};
export function parseArgs(argv: string[]): { command: "post" | "update" | "resolve" | "list"; id: string | null; options: ServiceNoticeOptions };
export function postRequest(options: ServiceNoticeOptions): {
  by: string | null;
  kind: string;
  severity: string;
  title: string;
  body: string;
  starts: string | null;
  ends: string | null;
  firms: string[] | null;
  publish: boolean;
};
