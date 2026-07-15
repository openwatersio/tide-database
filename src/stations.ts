import type {
  HarmonicConstituent,
  Station,
  StationData,
  StationMeta,
} from "./types.js";
import { createStationMeta } from "./station-bundle.js" with { type: "macro" };
import { createStationHeavy } from "./station-bundle.js" with { type: "macro" };
import { createDatumEnum } from "./station-bundle.js" with { type: "macro" };
import quality from "../quality.json" with { type: "json" };

/** All datum keys present across the database (e.g. "MLLW", "MSL", "NAVD88"). */
export const datums: string[] = createDatumEnum();

// Metadata is inlined as object literals (~15 MB of live objects). Heavy fields
// are inlined as an array of per-station JSON string literals and parsed on
// demand, so importing this module no longer materializes all 6,000+ stations'
// harmonics (which cost ~118 MB of heap / ~660 MB RSS eagerly).
const meta: StationMeta[] = createStationMeta();
const heavy: string[] = createStationHeavy();

const indexById = new Map(meta.map((m, i) => [m.id, i] as const));

interface HeavyFields {
  harmonic_constituents: HarmonicConstituent[];
  datums: Record<string, number>;
  epoch?: StationData["epoch"];
}

function parseHeavy(index: number): HeavyFields {
  return JSON.parse(heavy[index]!);
}

function makeStation(m: StationMeta, index: number): Station {
  // Subordinate stations predict from their reference station's harmonics and
  // datums (their own offsets still apply). Resolve to the reference's heavy
  // data; fall back to self if the reference is somehow missing.
  const dataIndex =
    m.type === "subordinate" && m.offsets
      ? (indexById.get(m.offsets.reference) ?? index)
      : index;

  const station = { ...m } as Station;

  // Getters keep the sync API: reading these fields parses one station's heavy
  // blob. No caching — a persistent cache on these module-level objects would
  // grow back toward the full 118 MB on a process that touches every station.
  Object.defineProperties(station, {
    harmonic_constituents: {
      enumerable: true,
      configurable: true,
      get: () => parseHeavy(dataIndex).harmonic_constituents,
    },
    datums: {
      enumerable: true,
      configurable: true,
      get: () => parseHeavy(dataIndex).datums,
    },
    epoch: {
      enumerable: true,
      configurable: true,
      get: () => parseHeavy(index).epoch,
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
