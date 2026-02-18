#!/usr/bin/env node

import { readFile, unlink } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseCSV, indexBy, groupBy } from "./util.ts";
import {
  normalize,
  save,
  DATA_DIR,
  type PartialStationData,
} from "./station.ts";
import { computeDatums } from "./datum.ts";
import {
  distance,
  compareStationPriority,
  MIN_DISTANCE_TO_NOAA,
  MIN_DISTANCE_TICON,
  getSourceSuffix,
  NON_COMMERCIAL_SOURCES,
} from "./filtering.ts";
import { cleanName } from "./name-cleanup.ts";
import { loadGeocoder } from "./geocode.ts";
import { near } from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const metaPath = join(__dirname, "..", "tmp", "TICON-4", "meta.csv");
const dataPath = join(__dirname, "..", "tmp", "TICON-4", "data.csv");
const metadata = indexBy(
  parseCSV<TiconMetaRow>(await readFile(metaPath, "utf-8")),
  "FILE NAME",
);
const data = await readFile(dataPath, "utf-8");

type TiconMetaRow = {
  "FILE NAME": string;
  "SITE NAME": string;
};

interface TiconRow {
  lat: string;
  lon: string;
  tide_gauge_name: string;
  type: string;
  country: string;
  gesla_source: string;
  record_quality: string;
  datum_information: string;
  years_of_obs: string;
  start_date: string;
  end_date: string;
  con: string;
  amp: string;
  pha: string;
  amp_std: string;
  pha_std: string;
  missing_obs: string;
  no_of_obs: string;
}

function dayMonthYearToDate(date: string) {
  const [day, month, year] = date.split("/").map((v) => parseInt(v, 10));
  if (!day || !month || !year) {
    throw new Error(`Invalid date: ${date}`);
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

function candidateId(c: Candidate) {
  return `ticon/${c.source.id}`;
}

// Load geocoder
const geocoder = await loadGeocoder();

type Candidate = Omit<PartialStationData, "datums">;

/**
 * Imports TICON-4 stations with integrated filtering.
 *
 * Pipeline:
 *   Phase 1: Convert CSV rows to station objects (without datums)
 *   Phase 2: Filter candidates (NOAA proximity → quality issues → duplicates)
 *   Phase 3: Compute datums and save surviving stations
 */
async function main() {
  // ── Phase 1: Convert ──────────────────────────────────────────────────
  console.log("=== Phase 1: Converting TICON stations ===\n");

  const groups = Object.values(
    groupBy(parseCSV<TiconRow>(data), (r) => r.tide_gauge_name),
  );

  const candidates: Candidate[] = [];

  for (const rows of groups) {
    if (!rows[0]) continue;

    const gesla = metadata[rows[0].tide_gauge_name];
    const epochStart = dayMonthYearToDate(rows[0].start_date);
    const epochEnd = dayMonthYearToDate(rows[0].end_date);

    const cleaned = cleanName(gesla["SITE NAME"], rows[0].country);
    const lat = parseFloat(rows[0].lat);
    const lon = parseFloat(rows[0].lon);

    // Geocode: resolve opaque names and fill region
    let name = cleaned.name;
    let region = cleaned.region;
    const geo = geocoder.nearest(lat, lon, 50);
    if (cleaned.isOpaque && geo) {
      name = geo.place.name;
    }
    if (!region && geo?.region) {
      region = geo.region;
    }

    candidates.push({
      name,
      ...(region ? { region } : {}),
      country: rows[0].country,
      latitude: lat,
      longitude: lon,
      type: "reference",
      disclaimers: rows[0].record_quality,
      source: {
        name: "TICON-4",
        url: "https://www.seanoe.org/data/00980/109129/",
        id: rows[0].tide_gauge_name,
        published_harmonics: true,
      },
      license: NON_COMMERCIAL_SOURCES.includes(
        getSourceSuffix(rows[0].tide_gauge_name),
      )
        ? {
            type: "cc-by-nc-4.0",
            commercial_use: false,
            url: "https://creativecommons.org/licenses/by-nc/4.0/",
            notes:
              "Upstream GESLA data provider restricts commercial use. See https://gesla787883612.wordpress.com/license/",
          }
        : {
            type: "cc-by-4.0",
            commercial_use: true,
            url: "https://creativecommons.org/licenses/by/4.0/",
          },
      harmonic_constituents: rows.map((row) => ({
        name: row.con,
        amplitude: parseFloat(row.amp) / 100, // cm to m
        phase: ((parseFloat(row.pha) % 360) + 360) % 360,
      })),
      epoch: {
        start: epochStart.toISOString().split("T")[0]!,
        end: epochEnd.toISOString().split("T")[0]!,
      },
    });
  }

  console.log(`Total TICON groups: ${groups.length}`);
  console.log(`Candidates: ${candidates.length}\n`);

  // ── Phase 2: Filter ───────────────────────────────────────────────────
  console.log("=== Phase 2: Filtering ===\n");

  const removed = new Set<string>();

  // Step 1a: Remove NOAA-sourced TICON candidates (we have original NOAA data)
  console.log("Step 1a: Removing NOAA-sourced TICON candidates...");
  let noaaSourceCount = 0;

  for (const c of candidates) {
    if (getSourceSuffix(c.source.id) === "noaa") {
      removed.add(candidateId(c));
      noaaSourceCount++;
    }
  }

  console.log(`  Removed ${noaaSourceCount} NOAA-sourced candidates\n`);

  // Step 1b: Remove candidates within 100m of NOAA stations
  console.log(
    `Step 1b: Finding candidates within ${MIN_DISTANCE_TO_NOAA * 1000}m of NOAA...`,
  );
  let nearNoaaCount = 0;

  for (const c of candidates) {
    const id = candidateId(c);
    if (removed.has(id)) continue;

    const nearby = near({
      latitude: c.latitude,
      longitude: c.longitude,
      maxDistance: MIN_DISTANCE_TO_NOAA,
      maxResults: 1,
      filter: (s) => s.id.startsWith("noaa/"),
    });

    if (nearby.length > 0) {
      const [noaa, dist] = nearby[0]!;
      removed.add(id);
      nearNoaaCount++;
      if (nearNoaaCount <= 5) {
        console.log(
          `  ${id} → within ${(dist * 1000).toFixed(0)}m of ${noaa.id}`,
        );
      }
    }
  }

  console.log(`  Removed ${nearNoaaCount} candidates near NOAA\n`);

  // Step 2: Remove candidates with quality issues if a better alternative exists nearby
  console.log(
    "Step 2: Finding candidates with quality issues that have better alternatives...",
  );
  let qualityRemovals = 0;

  for (const c of candidates) {
    const id = candidateId(c);
    if (removed.has(id)) continue;
    if (!c.disclaimers?.includes("quality control issues")) continue;

    for (const other of candidates) {
      const otherId = candidateId(other);
      if (otherId === id || removed.has(otherId)) continue;
      if (other.disclaimers?.includes("quality control issues")) continue;

      const dist = distance(
        c.latitude,
        c.longitude,
        other.latitude,
        other.longitude,
      );
      if (dist <= 0.1) {
        removed.add(id);
        qualityRemovals++;
        if (qualityRemovals <= 5) {
          console.log(
            `  ${id} → quality issues; ${otherId} (${getSourceSuffix(other.source.id)}) at ${(dist * 1000).toFixed(0)}m`,
          );
        }
        break;
      }
    }
  }

  console.log(`  Removed ${qualityRemovals} candidates with quality issues\n`);

  // Step 3: Remove duplicate/nearby candidates (keep highest priority)
  console.log(
    `Step 3: Finding duplicates within ${MIN_DISTANCE_TICON * 1000}m...`,
  );
  let duplicateCount = 0;
  const processed = new Set<string>();

  for (const c of candidates) {
    const id = candidateId(c);
    if (removed.has(id) || processed.has(id)) continue;

    const nearby: Candidate[] = [];
    for (const other of candidates) {
      const otherId = candidateId(other);
      if (otherId === id || removed.has(otherId) || processed.has(otherId))
        continue;

      const dist = distance(
        c.latitude,
        c.longitude,
        other.latitude,
        other.longitude,
      );
      if (dist <= MIN_DISTANCE_TICON) {
        nearby.push(other);
      }
    }

    if (nearby.length === 0) {
      processed.add(id);
      continue;
    }

    const group = [c, ...nearby];

    group.sort((a, b) => compareStationPriority(a, b));

    const [keep, ...others] = group;
    processed.add(candidateId(keep!));

    for (const other of others) {
      removed.add(candidateId(other));
      processed.add(candidateId(other));
      duplicateCount++;
    }
  }

  console.log(`  Removed ${duplicateCount} duplicate candidates\n`);

  // Filter summary
  const surviving = candidates.filter((c) => !removed.has(candidateId(c)));

  console.log("=== Filter Summary ===\n");
  console.log(`Total removed: ${removed.size}`);
  console.log(`  - NOAA-sourced: ${noaaSourceCount}`);
  console.log(`  - Near NOAA: ${nearNoaaCount}`);
  console.log(`  - Quality issues: ${qualityRemovals}`);
  console.log(`  - Duplicates: ${duplicateCount}`);
  console.log(`Remaining: ${surviving.length}\n`);

  // Delete data files for rejected stations
  let deleted = 0;
  for (const id of removed) {
    const filePath = join(DATA_DIR, `${id}.json`);
    try {
      await unlink(filePath);
      deleted++;
    } catch {
      // File may not exist from a previous import
    }
  }
  if (deleted > 0) {
    console.log(`Deleted ${deleted} existing files for rejected stations\n`);
  }

  // ── Phase 3: Compute datums and save ──────────────────────────────────
  const forceDatums = process.env["FORCE_DATUMS"] === "1";
  console.log(
    `=== Phase 3: Computing datums and saving ===${forceDatums ? " (forcing recalculation)" : ""}\n`,
  );

  let saved = 0;
  let reused = 0;
  let errors = 0;

  for (const c of surviving) {
    const id = candidateId(c);

    try {
      let datums: Record<string, number> | undefined;
      let epoch = c.epoch;

      if (!forceDatums) {
        try {
          const existing = JSON.parse(
            await readFile(join(DATA_DIR, `${id}.json`), "utf-8"),
          );
          if (existing.datums) {
            datums = existing.datums;
            if (existing.epoch) epoch = existing.epoch;
            reused++;
          }
        } catch {
          // File doesn't exist, will compute
        }
      }

      if (!datums) {
        const result = computeDatums(c.harmonic_constituents, {
          start: new Date(c.epoch!.start),
          end: new Date(c.epoch!.end),
        });
        datums = result.datums;
        epoch = {
          start: result.start.toISOString().split("T")[0]!,
          end: result.end.toISOString().split("T")[0]!,
        };
      }

      await save("ticon", normalize({ ...c, datums, epoch: epoch! }));
      saved++;
      process.stdout.write(".");
      if (saved % 100 === 0) {
        process.stdout.write(` ${saved}/${surviving.length}\n`);
      }
    } catch (err: any) {
      console.error(`\nError processing ${id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n\nDone. Saved ${saved} stations.`);
  if (reused > 0) {
    console.log(`Reused existing datums: ${reused}`);
  }
  if (errors > 0) {
    console.log(`Errors: ${errors}`);
  }
}

main();
