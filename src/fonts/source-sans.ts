import localFont from "next/font/local";

/**
 * Source Sans 3 (SIL Open Font License 1.1, see ./source-sans-3/OFL.txt).
 * Latin variable, weights 200–900. Interface text. Erode stays the display face.
 */
export const sourceSans = localFont({
  src: [{ path: "./source-sans-3/SourceSans3-Latin-Variable.woff2", weight: "200 900", style: "normal" }],
  variable: "--font-source-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
  adjustFontFallback: "Arial",
});
