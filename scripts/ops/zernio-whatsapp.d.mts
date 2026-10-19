export const WEBHOOK_EVENTS: string[];
export function templateRequests(
  accountId: string,
  origin?: string,
): {
  accountId: string;
  name: string;
  category: "UTILITY";
  language: "en";
  components: { type: "body"; text: string; example: { body_text: string[][] } }[];
}[];
