import type { Station } from "@neaps/tide-database";

export type Variant = "lean" | "full";

/**
 * 64-bit FNV-1a hash of the station id, truncated to 53 bits so it fits in a
 * JavaScript safe integer. MVT feature ids must be unsigned integers, and a
 * stable hash keeps ids consistent across builds as stations come and go.
 */
export function featureId(id: string): number {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < id.length; i++) {
    hash ^= BigInt(id.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return Number(hash & 0x1fffffffffffffn);
}

type Properties = Record<string, string | number | boolean>;

/**
 * Vector tile properties only support scalar values, so nested objects
 * (datums, harmonic_constituents, offsets, source, license, epoch) are
 * encoded as JSON strings for clients to JSON.parse.
 */
function properties(station: Station, variant: Variant): Properties {
  const lean: Properties = {
    id: station.id,
    name: station.name,
    type: station.type,
  };

  if (variant === "lean") return lean;

  return {
    ...lean,
    country: station.country,
    continent: station.continent,
    timezone: station.timezone,
    chart_datum: station.chart_datum,
    source: JSON.stringify(station.source),
    license: JSON.stringify(station.license),
    ...(station.region && { region: station.region }),
    ...(station.disclaimers && { disclaimers: station.disclaimers }),
    ...(station.datums &&
      Object.keys(station.datums).length > 0 && {
        datums: JSON.stringify(station.datums),
      }),
    ...(station.harmonic_constituents?.length > 0 && {
      harmonic_constituents: JSON.stringify(station.harmonic_constituents),
    }),
    ...(station.offsets && { offsets: JSON.stringify(station.offsets) }),
    ...(station.epoch && { epoch: JSON.stringify(station.epoch) }),
  };
}

export function toFeature(station: Station, variant: Variant) {
  return {
    type: "Feature",
    id: featureId(station.id),
    geometry: {
      type: "Point",
      coordinates: [station.longitude, station.latitude],
    },
    properties: properties(station, variant),
  };
}
