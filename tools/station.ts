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
  "chart_datum",
  "type",
  "harmonic_constituents",
  "offsets",
];

// Preferred chart datum by country. Names must match country-code-lookup output.
// Countries not listed default to LAT (IHO international standard).
const CHART_DATUMS: Record<string, string> = {
  // MLLW countries (US convention)
  "United States": "MLLW",
  "The Bahamas": "MLLW",
  Philippines: "MLLW",
  "Marshall Islands": "MLLW",
  Palau: "MLLW",
  "Federated States of Micronesia": "MLLW",
  // Other national datums (fall back to LAT if unavailable)
  Canada: "LLWLT",
  Japan: "NLLW",
  China: "TLT",
  "South Korea": "ALLW",
};

/**
 * Determine the chart datum for a station based on its country and
 * available datums. Uses the country's preferred datum if it exists in
 * the station's datum values, otherwise falls back to LAT.
 */
export function getChartDatum(
  country: string,
  availableDatums: Record<string, number>,
): string {
  const preferred = CHART_DATUMS[country];
  return preferred && preferred in availableDatums ? preferred : "LAT";
}

type OptionalProperties = "timezone" | "continent" | "chart_datum";
export type PartialStationData = Omit<StationData, OptionalProperties> &
  Partial<Pick<StationData, OptionalProperties>>;

export function normalize(station: PartialStationData): StationData {
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
      chart_datum:
        station.chart_datum ?? getChartDatum(country, station.datums),
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
