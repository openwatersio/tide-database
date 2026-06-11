#!/usr/bin/env node
/**
 * Generates newline-delimited GeoJSON for the vector tile build. Two variants
 * are produced: a lean one (id/name/type) for low-zoom tiles and a full one
 * (all station data) for high-zoom tiles. The `build` script feeds these to
 * tippecanoe and merges the results into a single PMTiles file.
 */

import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { stations } from "@neaps/tide-database";
import { featureId, toFeature, type Variant } from "./features.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "dist");

// Web Mercator latitude limit — tippecanoe silently clips beyond it
const MAX_LATITUDE = 85.0511;

const sorted = [...stations].sort((a, b) => a.id.localeCompare(b.id));

const ids = new Map<number, string>();
for (const station of sorted) {
  if (
    Math.abs(station.latitude) > MAX_LATITUDE ||
    Math.abs(station.longitude) > 180
  ) {
    throw new Error(`Station ${station.id} is outside Web Mercator bounds`);
  }

  const id = featureId(station.id);
  const existing = ids.get(id);
  if (existing) {
    throw new Error(
      `Feature id collision between ${existing} and ${station.id}`,
    );
  }
  ids.set(id, station.id);
}

await mkdir(outDir, { recursive: true });

for (const variant of ["lean", "full"] as Variant[]) {
  const ndjson = sorted
    .map((station) => JSON.stringify(toFeature(station, variant)))
    .join("\n");
  await writeFile(join(outDir, `stations-${variant}.ndjson`), ndjson + "\n");
}

console.log(`Wrote ${sorted.length} stations`);
