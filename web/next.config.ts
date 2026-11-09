import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // the floating "N" badge covered the sidebar footer
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
