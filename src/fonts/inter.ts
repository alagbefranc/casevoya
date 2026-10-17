import localFont from "next/font/local";

/** Inter (SIL Open Font License 1.1, see ./inter/OFL.txt). Latin subset, variable weight. Interface text per DESIGN.md. */
export const inter = localFont({
  src: [{ path: "./inter/Inter-Latin-Variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});
