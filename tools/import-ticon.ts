#!/usr/bin/env node

import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseCSV, indexBy, groupBy } from "./util.ts";
import { normalize, save } from "./station.ts";
import { computeDatums } from "./datum.ts";
import type { StationData, HarmonicConstituent } from "../src/index.ts";

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

/**
 * Converts TICON-4 CSV files to station JSON format
 *
 * The script reads a TICON-4 CSV file and creates JSON files in the data/ directory
 * that conform to the station schema. Each unique station (by lat/lon/name) becomes
 * one JSON file with all its harmonic constituents aggregated.
 */
async function main() {
  const stations = Object.values(
    groupBy(parseCSV<TiconRow>(data), (r) => r.tide_gauge_name),
  );

  let created = 0;

  for (const rows of stations) {
    const station = convertStation(rows);
    if (station) {
      await save("ticon", station);
      created++;
      process.stdout.write(".");
    }
  }

  console.log(`\nDone. Created ${created} files`);
}

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

/**
 * Convert a TICON-4 station to our JSON schema format
 */
function convertStation(rows: TiconRow[]): StationData | void {
  if (!rows[0]) {
    throw new Error("No rows to convert");
  }

  if (rows[0].tide_gauge_name.includes("usa-noaa")) {
    // Skip NOAA stations as they are available from NOAA directly
    return;
  }

  const gesla = metadata[rows[0].tide_gauge_name];

  const constituents: HarmonicConstituent[] = rows.map((row) => ({
    name: row.con,
    amplitude: parseFloat(row.amp) / 100, // convert cm to m
    phase: ((parseFloat(row.pha) % 360) + 360) % 360, // lag in degrees; normalize to [0, 360)
  }));

  const { datums, start, end } = computeDatums(constituents, {
    start: dayMonthYearToDate(rows[0].start_date),
    end: dayMonthYearToDate(rows[0].end_date),
  });

  // Create the station JSON
  return normalize({
    name: gesla["SITE NAME"],
    country: rows[0].country,
    latitude: parseFloat(rows[0].lat),
    longitude: parseFloat(rows[0].lon),
    type: "reference",
    disclaimers: rows[0].record_quality,
    source: {
      name: "TICON-4",
      url: "https://www.seanoe.org/data/00980/109129/",
      id: rows[0].tide_gauge_name,
      published_harmonics: true,
    },
    license: {
      type: "cc-by-4.0",
      commercial_use: true,
      url: "https://creativecommons.org/licenses/by/4.0/",
    },
    harmonic_constituents: constituents,
    datums,
    epoch: {
      start: start.toISOString().split("T")[0]!,
      end: end.toISOString().split("T")[0]!,
    },
  });
}

main();
