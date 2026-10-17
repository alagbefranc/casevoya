import localFont from "next/font/local";

/** Erode (Fontshare, ITF Free Font License). Static files, not a subset. */
export const erode = localFont({
  src: [
    { path: "./erode/Erode-Light.woff2", weight: "300", style: "normal" },
    { path: "./erode/Erode-LightItalic.woff2", weight: "300", style: "italic" },
    { path: "./erode/Erode-Regular.woff2", weight: "400", style: "normal" },
    { path: "./erode/Erode-Italic.woff2", weight: "400", style: "italic" },
    { path: "./erode/Erode-Medium.woff2", weight: "500", style: "normal" },
    { path: "./erode/Erode-Semibold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-erode",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Georgia", "serif"],
});
