// Copies the generated pack next to the bundled Node entry so the runtime
// `new URL("./generated/stations.pack", import.meta.url)` resolves in dist.
// Only the Node build reads the pack; the browser build bundles the data.
import { mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "node", "generated"), { recursive: true });
copyFileSync(
  join(root, "src", "generated", "stations.pack"),
  join(root, "dist", "node", "generated", "stations.pack"),
);
console.log("copied stations.pack -> dist/node/generated/");
