export type ServiceLevelArgs = {
  command: "record" | "report";
  firm: string;
  ticket: string | null;
  received: string | null;
  responded: string | null;
  recordedBy: string | null;
  months: number;
  dryRun: boolean;
};
export function parseArgs(argv: string[]): ServiceLevelArgs;
