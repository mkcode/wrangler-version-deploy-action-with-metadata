import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  sourcemap: true,
  minify: true,
  bundle: true,
  splitting: false,
  dts: false,

  // Ensure dependencies used by the GitHub Action are bundled into dist/index.js
  // so the published action tarball is fully self-contained.
  noExternal: ["@actions/core", "@actions/exec"],
});
