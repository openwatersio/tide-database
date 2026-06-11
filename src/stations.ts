import type { Station, StationData } from "./types.js";
import quality from "../quality.json" with { type: "json" };

const modules = import.meta.glob<StationData>("./**/*.json", {
  eager: true,
  import: "default",
  base: "../data",
});

export const qualityMap = new Map(quality.map((s) => [s.id, s]));

export function qualityFilter(station: Station): boolean {
  return qualityMap.get(station.id)?.accepted ?? false;
}

export const allStations: Station[] = Object.entries(modules).map(
  ([path, data]) => {
    const id = path.replace(/^\.\//, "").replace(/\.json$/, "");
    return { id, ...data };
  },
);

export const stationsById = new Map(allStations.map((s) => [s.id, s]));

export const stations: Station[] = allStations.filter(qualityFilter);

// Populate subordinate stations with datums and harmonic constituents from their reference stations.
allStations.forEach((station) => {
  if (station.type === "subordinate") {
    const reference = stationsById.get(station.offsets!.reference);
    if (!reference)
      throw new Error(
        `Reference station ${station.offsets!.reference} not found for station ${station.id}`,
      );

    const { datums, harmonic_constituents } = reference;
    Object.assign(station, { datums, harmonic_constituents });
  }
});
