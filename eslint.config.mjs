import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // OpenNext and Wrangler build output.
    ".open-next/**",
    ".wrangler/**",
    // The Vo agent container runtime has its own package and tsconfig (services/vo-agent).
    "services/vo-agent/runtime/**",
    "services/vo-agent/dist/**",
    "services/vo-agent/node_modules/**",
    // The virus scanner container runtime (services/av-scanner), likewise.
    "services/av-scanner/runtime/**",
    "services/av-scanner/dist/**",
    "services/av-scanner/node_modules/**",
    // Vendored pdf.js worker (minified third-party build).
    "public/pdfjs/**",
  ]),
  {
    files: ["src/components/port/**/*.{ts,tsx}", "src/components/portal/**/*.{ts,tsx}", "src/components/sheet/**/*.{ts,tsx}"],
    rules: {
      // The converted screens keep the designer's markup, anchors and location changes.
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-location-assign-relative-destination": "off",
      "jsx-a11y/aria-unsupported-elements": "off",
    },
  },
  {
    files: ["src/components/sheet/markup/**/*.{ts,tsx}"],
    rules: {
      // Captured designer DOM. Unused variant args and incomplete ARIA stay as captured.
      "@typescript-eslint/no-unused-vars": "off",
      "jsx-a11y/role-has-required-aria-props": "off",
    },
  },
]);

export default eslintConfig;
