import { defineConfig } from "tsdown";
import macros from "unplugin-macros/rolldown";

// Two builds. The Node build resolves `#station-data` to station-data.ts (reads
// the off-heap pack file); the browser build resolves it to
// station-data.browser.ts (bundled JSON strings). package.json `exports`
// conditions select between dist/node and dist/browser.
const base = {
  entry: ["./src/index.ts"],
  dts: true,
  minify: true,
  sourcemap: true,
  target: "es2020",
  plugins: [macros()],
};

// ESM only. kdbush and geokdbush are ESM-only, so a CJS build can't require them
// cleanly; all first-party consumers use ESM. `#station-data` resolves per build.
export default defineConfig([
  { ...base, platform: "neutral", format: ["esm"], outDir: "dist/node" },
  { ...base, platform: "browser", format: ["esm"], outDir: "dist/browser" },
]);
