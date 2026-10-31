import "server-only";
import { appOrigin } from "@/lib/email/env";
import { INTEGRATIONS_PATH } from "@/modules/sheet/settings-integrations-present";

/**
 * Where Composio's Connect Link returns to: Settings > Integrations on the configured app origin.
 * Built on the server only; never taken from the browser or request headers.
 */
export function composioCallbackUrl(toolkit: string): string {
  return `${appOrigin()}${INTEGRATIONS_PATH}&connected=${encodeURIComponent(toolkit)}`;
}
