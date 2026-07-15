import type { StationData, StationMeta, StationMetaKey } from "./types.js";

// Build-time only. This module reads the raw station JSON and splits it into
// light metadata (bundled eagerly) and heavy fields (bundled as unparsed JSON
// strings, parsed one station at a time at runtime). It is never included in
// the runtime bundle: stations.ts imports the create*Json functions as macros
// (only their string results are inlined), and the search index macros call
// loadStationMeta() at build time.

const META_KEYS: StationMetaKey[] = [
  "name",
  "latitude",
  "longitude",
  "region",
  "country",
  "continent",
  "timezone",
  "type",
  "disclaimers",
  "chart_datum",
  "datums_source",
  "source",
  "license",
  "offsets",
];

function readAll(): { id: string; data: StationData }[] {
  const modules = import.meta.glob<StationData>("./**/*.json", {
    eager: true,
    import: "default",
    base: "../data",
  });
  // Object.entries preserves the glob's sorted key order, so the metadata array,
  // the heavy array, and the geo/text indexes all share one station ordering.
  return Object.entries(modules).map(([path, data]) => ({
    id: path.replace(/^\.\//, "").replace(/\.json$/, ""),
    data,
  }));
}

/**
 * The set of datum keys present across all stations, computed at build time and
 * inlined as a small array literal. Lets consumers (e.g. the API's OpenAPI spec)
 * get the datum enum without a runtime scan that would parse every station.
 */
export function createDatumEnum(): string[] {
  const datums = new Set<string>();
  for (const { data } of readAll()) {
    if (data.datums)
      for (const key of Object.keys(data.datums)) datums.add(key);
  }
  return [...datums];
}

/** Light metadata for every station, in bundle order. Used at build time. */
export function loadStationMeta(): StationMeta[] {
  return readAll().map(({ id, data }) => {
    const meta = { id } as StationMeta;
    for (const key of META_KEYS) {
      const value = data[key];
      if (value !== undefined) (meta as Record<string, unknown>)[key] = value;
    }
    return meta;
  });
}

/**
 * Metadata array, inlined into the runtime bundle via a macro as an array of
 * object literals (the live objects — no retained JSON string, no parse).
 */
export function createStationMeta(): StationMeta[] {
  return loadStationMeta();
}

/**
 * Heavy fields (harmonic_constituents, datums, epoch) as an array of per-station
 * JSON strings, inlined as an array of string literals. The strings are the live
 * data; each is JSON.parsed on demand, so importing the bundle never
 * materializes all stations' harmonics at once.
 */
export function createStationHeavy(): string[] {
  return readAll().map(({ data }) =>
    JSON.stringify({
      harmonic_constituents: data.harmonic_constituents ?? [],
      datums: data.datums ?? {},
      epoch: data.epoch,
    }),
  );
}
