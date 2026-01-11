import type { StationData } from "../src/index.js";
import { find as findTz } from "geo-tz/all";
import countryLookup from "country-code-lookup";
import { join, dirname } from "path";
import { mkdir, writeFile } from "fs/promises";
import sortObject from "sort-object-keys";

const __dirname = new URL(".", import.meta.url).pathname;
export const DATA_DIR = join(__dirname, "..", "data");

const sortOrder: (keyof StationData)[] = [
  "name",
  "region",
  "country",
  "continent",
  "latitude",
  "longitude",
  "timezone",
  "source",
  "license",
  "disclaimers",
  "datums",
  "type",
  "harmonic_constituents",
  "offsets",
];

export function normalize(
  station: Omit<StationData, "timezone" | "continent">,
): StationData {
  const { iso2, continent, country } =
    countryLookup.byCountry(station.country) ||
    countryLookup.byIso(station.country) ||
    {};

  if (!iso2 || !continent || !country) {
    throw new Error(
      `Unable to find country info for station: ${station.name} (${station.country})`,
    );
  }

  const timezone = findTz(station.latitude, station.longitude)[0];

  if (!timezone) {
    throw new Error(
      `Unable to find timezone for station: ${station.name} (${station.latitude}, ${station.longitude})`,
    );
  }

  return sortObject(
    {
      ...station,
      timezone,
      continent,
      country,
    },
    sortOrder,
  );
}

export async function save(source: string, data: StationData) {
  const filePath = join(DATA_DIR, source, `${data.source.id}.json`);
  const directory = dirname(filePath);

  // Create directory if it doesn't exist
  await mkdir(directory, { recursive: true });

  // Write the JSON file
  return writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}
