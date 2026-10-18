import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // The governance module is server-only. Tests import the pure validators.
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts"),
      "next/headers": path.resolve(import.meta.dirname, "tests/helpers/next-headers-stub.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // The RLS suites run whole migration sets in PGlite; on a busy runner one case can pass 5s.
    testTimeout: 30_000,
  },
});
