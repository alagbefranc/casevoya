import { afterEach, describe, expect, it } from "vitest";
import "@/instrumentation-client";
import { z } from "zod";

describe("Zod jitless", () => {
  const original = globalThis.Function;

  afterEach(() => {
    globalThis.Function = original;
  });

  it("sets the flag Zod 4.6.7 reads before schemas are parsed", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("parses an object schema without calling Function", () => {
    const calls: unknown[][] = [];
    const Real = original;
    globalThis.Function = new Proxy(Real, {
      construct(_target, args) {
        calls.push(args);
        return Reflect.construct(Real, args);
      },
      apply(_target, thisArg, args) {
        calls.push(args);
        return Reflect.apply(Real, thisArg, args);
      },
    }) as FunctionConstructor;
    const parsed = z.object({ name: z.string() }).parse({ name: "Ada" });
    expect(parsed).toEqual({ name: "Ada" });
    expect(calls).toEqual([]);
  });
});
