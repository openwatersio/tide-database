import type { Station, StationData } from "./types.js";
import quality from "../tmp/quality.json" with { type: "json" };

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

export const stations: Station[] = allStations.filter(qualityFilter);
