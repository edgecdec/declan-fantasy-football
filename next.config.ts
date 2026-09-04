import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // better-sqlite3 is a native module — it must stay external or the bundler
  // tries to trace and bundle the .node binary and the route handler crashes.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
