import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The magic link's redirect uses the configured app origin (appOrigin), not the request's Origin.

const state = vi.hoisted(() => ({
  otp: [] as { email: string; options: { emailRedirectTo: string; shouldCreateUser: boolean } }[],
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: state.headers }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithOtp: async (input: (typeof state.otp)[number]) => {
        state.otp.push(input);
        return { error: null };
      },
    },
  }),
}));

const { sendMagicLink } = await import("@/app/sign-in/actions");

function form(email: string, next = "/app") {
  const data = new FormData();
  data.set("email", email);
  data.set("next", next);
  return data;
}

async function send(data: FormData) {
  await expect(sendMagicLink(data)).rejects.toThrow(/^REDIRECT:/);
}

const originalAppUrl = process.env.APP_URL;

beforeEach(() => {
  state.otp = [];
  state.headers.mockReset();
  state.headers.mockResolvedValue(new Headers({ origin: "https://attacker.example" }));
});

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

describe("sendMagicLink", () => {
  it("uses APP_URL for the emailed link and ignores the Origin header", async () => {
    process.env.APP_URL = "https://app.example.test";
    await send(form("person@example.test", "/app/matters"));
    expect(state.otp).toHaveLength(1);
    expect(state.otp[0].options.emailRedirectTo).toBe(
      `https://app.example.test/auth/confirm?next=${encodeURIComponent("/app/matters")}`,
    );
    expect(state.otp[0].options.emailRedirectTo).not.toContain("attacker.example");
  });

  it("keeps http://localhost working for development", async () => {
    process.env.APP_URL = "http://localhost:3000";
    await send(form("person@example.test"));
    expect(state.otp[0].options.emailRedirectTo).toBe(`http://localhost:3000/auth/confirm?next=${encodeURIComponent("/app")}`);
  });

  it("falls back to the production app when APP_URL is unset or not https", async () => {
    delete process.env.APP_URL;
    await send(form("person@example.test"));
    process.env.APP_URL = "http://app.example.test";
    await send(form("person@example.test"));
    expect(state.otp.map((call) => new URL(call.options.emailRedirectTo).origin)).toEqual([
      "https://app.casevoya.ca",
      "https://app.casevoya.ca",
    ]);
  });

  it("still refuses an invalid email without sending", async () => {
    await expect(sendMagicLink(form("not-an-email"))).rejects.toThrow(/REDIRECT:\/sign-in\?error=invalid_email/);
    expect(state.otp).toHaveLength(0);
  });
});
