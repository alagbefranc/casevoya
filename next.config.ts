import type { NextConfig } from "next";

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
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
