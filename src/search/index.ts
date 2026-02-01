import { around, distance } from "geokdbush";
import { stations } from "../stations.js";
import { createGeoIndex } from "./geo.js" with { type: "macro" };
import { loadGeoIndex } from "./geo.js";
import { createTextIndex } from "./text.js" with { type: "macro" };
import { loadTextIndex } from "./text.js";
import type { Station } from "../types.js";

export type Position = Latitude & Longitude;
type Latitude = { latitude: number } | { lat: number };
type Longitude = { longitude: number } | { lon: number } | { lng: number };

export type NearestOptions = Position & {
  maxDistance?: number;
  filter?: (station: Station) => boolean;
};

export type NearOptions = NearestOptions & {
  maxResults?: number;
};

export type TextSearchOptions = {
  filter?: (station: Station) => boolean;
  maxResults?: number;
};

/**
 * A tuple of a station and its distance from a given point, in kilometers.
 */
export type StationWithDistance = [Station, number];

// Load the indexes, which get inlined at build time
const geoIndex = loadGeoIndex(await createGeoIndex());
const textIndex = loadTextIndex(await createTextIndex());

/**
 * Find stations near a given position.
 */
export function near({
  maxDistance = Infinity,
  maxResults = 10,
  filter,
  ...position
}: NearOptions): StationWithDistance[] {
  const point = positionToPoint(position);

  const ids: number[] = around(
    geoIndex,
    ...point,
    maxResults,
    maxDistance,
    filter ? (id: number) => filter(stations[id]!) : undefined,
  );
  return ids.map((id) => {
    const station = stations[id]!;

    return [station, distance(...point, ...positionToPoint(station))] as const;
  });
}

/**
 * Find the single nearest station to a given position.
 */
export function nearest(options: NearestOptions): StationWithDistance | null {
  const results = near({ ...options, maxResults: 1 });
  return results[0] ?? null;
}

export function positionToPoint(options: Position): [number, number] {
  const longitude =
    "longitude" in options
      ? options.longitude
      : "lon" in options
        ? options.lon
        : options.lng;
  const latitude = "latitude" in options ? options.latitude : options.lat;
  return [longitude, latitude];
}

const stationMap = new Map(stations.map((s) => [s.id, s]));

/**
 * Search for stations by text across name, region, country, and continent.
 * Supports fuzzy matching and prefix search.
 */
export function search(
  query: string,
  { filter, maxResults = 20 }: TextSearchOptions = {},
): Station[] {
  const searchOptions: Parameters<typeof textIndex.search>[1] = {};

  if (filter) {
    searchOptions.filter = (result) => {
      const station = stationMap.get(result.id);
      return station ? filter(station) : false;
    };
  }

  const results = textIndex.search(query, searchOptions);

  return results
    .slice(0, maxResults)
    .map((result) => stationMap.get(result.id)!)
    .filter(Boolean);
}
