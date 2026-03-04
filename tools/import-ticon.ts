#!/usr/bin/env node

import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseCSV, indexBy, groupBy } from "./util.ts";
import { normalize, save, load, type PartialStationData } from "./station.ts";
import { computeDatums, resolveEpoch } from "./datum.ts";
import { getSourceSuffix, NON_COMMERCIAL_SOURCES } from "./filtering.ts";
import { cleanName } from "./name-cleanup.ts";
import { loadGeocoder } from "./geocode.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const metaPath = join(__dirname, "..", "tmp", "TICON-4", "meta.csv");
const dataPath = join(__dirname, "..", "tmp", "TICON-4", "data.csv");
const metadata = indexBy(
  parseCSV<TiconMetaRow>(await readFile(metaPath, "utf-8")),
  "FILE NAME",
);
const data = await readFile(dataPath, "utf-8");
const forceDatums = process.env["FORCE_DATUMS"] === "1";

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

// Load geocoder
const geocoder = await loadGeocoder();

/**
 * Imports all TICON-4 stations as clean source data.
 *
 * Converts CSV rows to station objects, computes datums, and saves all
 * stations. Quality evaluation happens separately via evaluate-quality.ts.
 */
async function main() {
  console.log(
    `=== Importing TICON stations ===${forceDatums ? " (forcing datum recalculation)" : ""}\n`,
  );

  const groups = Object.values(
    groupBy(parseCSV<TiconRow>(data), (r) => r.tide_gauge_name),
  );

  let saved = 0;
  let reused = 0;
  let errors = 0;

  for (const rows of groups) {
    if (!rows[0]) continue;

    const gesla = metadata[rows[0].tide_gauge_name];

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

    const harmonic_constituents = rows.map((row) => ({
      name: row.con,
      amplitude: parseFloat(row.amp) / 100, // cm to m
      phase: ((parseFloat(row.pha) % 360) + 360) % 360,
    }));

    const epoch = {
      start: dayMonthYearToDate(rows[0].start_date),
      end: dayMonthYearToDate(rows[0].end_date),
    };

    const id = rows[0].tide_gauge_name;

    try {
      const candidate: PartialStationData = {
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
          id,
          published_harmonics: true,
        },
        license: NON_COMMERCIAL_SOURCES.includes(getSourceSuffix(id))
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
        harmonic_constituents,
        ...(await getDatums(id, epoch, harmonic_constituents)),
      };

      await save("ticon", normalize(candidate));
      process.stdout.write(`.`);
      saved++;
    } catch (err: any) {
      console.error(`\nError processing ${id}: ${err.message}`);
      errors++;
      process.stdout.write(`x`);
    }

    if ((saved + errors) % 100 === 0) {
      process.stdout.write(`.${saved + errors}/${groups.length}\n`);
    }
  }

  console.log(`\n\nDone. Saved ${saved}/${groups.length} stations.`);
  if (reused > 0) console.log(`Reused existing datums: ${reused}.`);
  if (errors > 0) console.log(`Errors: ${errors}.`);
}

async function getDatums(
  id: string,
  obsEpoch: { start: Date; end: Date },
  harmonic_constituents: PartialStationData["harmonic_constituents"],
) {
  // Datum synthesis will always use 18.6-year nodal cycle, but for reporting and quality scoring we want to use
  // the actual observation period (which may be shorter). There should probably be separate records for observation
  // epoch vs datum epoch, but for now we'll use the smaller of the two.
  const datumEpoch = resolveEpoch(obsEpoch);

  const start = new Date(
    Math.max(datumEpoch.start.getTime(), obsEpoch.start.getTime()),
  );

  try {
    if (forceDatums) throw new Error("Forcing datum recalculation");

    const existing = await load("ticon", id);
    return {
      datums: existing.datums,
      epoch: {
        start: toISODate(start),
        end: toISODate(obsEpoch.end),
      },
    };
  } catch {
    const { datums, end } = computeDatums(harmonic_constituents, obsEpoch);
    return {
      datums,
      epoch: {
        start: toISODate(start),
        end: toISODate(end),
      },
    };
  }
}

function toISODate(date: Date) {
  return date.toISOString().split("T")[0]!;
}

main();
