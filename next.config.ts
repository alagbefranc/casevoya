import type { NextConfig } from "next";

const WORKERS = process.env.CASEVOYA_TARGET === "workers";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["127.0.0.1"],
  async redirects() {
    return [
      { source: "/sheet/portal", destination: "/portal", permanent: false },
      { source: "/sheet/portal-upload", destination: "/portal/upload", permanent: false },
      { source: "/sheet/portal-olena", destination: "/portal/olena", permanent: false },
      { source: "/sheet/portal-rafael", destination: "/portal/rafael", permanent: false },
      { source: "/sheet/matter", destination: "/portal/documents", permanent: false, has: [{ type: "query", key: "tab", value: "documents" }] },
      { source: "/sheet/matter", destination: "/portal/matters", permanent: false },
      // The legal pages live on the public site; the app's links (setup, sign-in footers) used to 404.
      { source: "/terms", destination: "https://casevoya.ca/terms", permanent: false },
      { source: "/privacy", destination: "https://casevoya.ca/privacy", permanent: false },
      { source: "/subprocessors", destination: "https://casevoya.ca/subprocessors", permanent: false },
      { source: "/help", destination: "https://casevoya.ca/help", permanent: false },
      { source: "/status", destination: "https://casevoya.ca/status", permanent: false },
    ];
  },
  // Off for the Cloudflare build until opennextjs-cloudflare#1318 is fixed; on everywhere else.
  // partialPrefetching requires cacheComponents, so they switch together.
  cacheComponents: !WORKERS,
  partialPrefetching: !WORKERS,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
