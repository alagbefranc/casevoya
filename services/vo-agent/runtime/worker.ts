/**
 * The `casevoya-vo-agent` Worker: the front of the Vo container (Cloudflare Containers,
 * https://developers.cloudflare.com/containers/, read 2026-10-18). It is reached only through the
 * app Worker's service binding (no route, workers_dev off) and forwards POST /v1/run to a
 * container instance. The container gets its secrets as environment variables; the request is
 * still checked against VO_AGENT_SECRET inside the container.
 */
import { Container, getRandom } from "@cloudflare/containers";

type Env = {
  VO_AGENT: DurableObjectNamespace<VoAgentContainer>;
  VO_AGENT_SECRET: string;
  ANTHROPIC_API_KEY?: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
};

export class VoAgentContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      VO_AGENT_SECRET: env.VO_AGENT_SECRET,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/run" || request.method !== "POST") return new Response(null, { status: 404 });
    const container = await getRandom(env.VO_AGENT, 3);
    return container.fetch(request);
  },
};
