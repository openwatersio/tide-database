import type { Station, StationMeta } from "./types.js";
import { createStationMeta } from "./station-bundle.js" with { type: "macro" };
import { createDatumEnum } from "./station-bundle.js" with { type: "macro" };
import { getData } from "#station-data";
import quality from "../quality.json" with { type: "json" };

/** All datum keys present across the database (e.g. "MLLW", "MSL", "NAVD88"). */
export const datums: string[] = createDatumEnum();

// Metadata (identity + offsets/source/etc) is inlined as object literals. The
// prediction data (harmonic_constituents, datums, epoch) comes from a per-runtime
// source (#station-data): an off-heap pack file on Node, bundled strings in the
// browser. Either way, importing this module holds no station data on the heap —
// a station's record is parsed only when its prediction fields are accessed.
const meta: StationMeta[] = createStationMeta();

function makeStation(m: StationMeta): Station {
  // Subordinate stations predict from their reference station's harmonics and
  // datums (their own offsets still apply); resolve to the reference's record.
  const dataId =
    m.type === "subordinate" && m.offsets ? m.offsets.reference : m.id;

  const station = { ...m } as Station;

  // Getters keep the sync API: reading these fields parses one station's record.
  // No caching — a persistent cache on these module-level objects would pull the
  // heavy data back onto the heap.
  Object.defineProperties(station, {
    harmonic_constituents: {
      enumerable: true,
      configurable: true,
      get: () => getData(dataId).harmonic_constituents,
    },
    datums: {
      enumerable: true,
      configurable: true,
      get: () => getData(dataId).datums,
    },
    epoch: {
      enumerable: true,
      configurable: true,
      get: () => getData(m.id).epoch,
    },
  });

  return station;
}

export const allStations: Station[] = meta.map(makeStation);

export const stationsById = new Map(allStations.map((s) => [s.id, s]));

export const qualityMap = new Map(quality.map((s) => [s.id, s]));

export function qualityFilter(station: Station): boolean {
  return qualityMap.get(station.id)?.accepted ?? false;
}

export const stations: Station[] = allStations.filter(qualityFilter);
