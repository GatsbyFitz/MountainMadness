import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    // Keeps the WebGL viewer chunk out of every other page's bundle.
    optimizePackageImports: ["@deck.gl/layers", "@deck.gl/core"],
  },
};

export default config;
