import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  /*
   * Build output location, overridable by env so a deploy can build into a scratch
   * directory and swap it in atomically.
   *
   * The deploy script used to `rm -rf .next` and then rebuild in place, which meant the
   * running server had no build under it for the whole build — and if the build then
   * failed, indefinitely. That is exactly how this site 502'd after a Next bump OOMed
   * the build. Unset (i.e. at runtime) this is plain `.next`, so nothing about serving
   * changes.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  // better-sqlite3 is a native module — it must stay external or the bundler
  // tries to trace and bundle the .node binary and the route handler crashes.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
