import { describe, it, expect, beforeAll } from "vitest";
import { gzipSync } from "zlib";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { stations } from "@neaps/tide-database";
import type { PMTiles } from "pmtiles";
import { featureId } from "../features.ts";
import {
  openPMTiles,
  lonLatToTile,
  decodeTile,
  getFeatures,
} from "./pmtiles.ts";

const path = join(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/neaps.pmtiles",
);

// Named keys (instead of the index signature on decoded MVT properties) so
// the strict noPropertyAccessFromIndexSignature config allows dot access.
type StationProperties = {
  id: string;
  name: string;
  type: string;
  country?: string;
  continent?: string;
  region?: string;
  timezone?: string;
  chart_datum?: string;
  disclaimers?: string;
  datums?: string;
  harmonic_constituents?: string;
  offsets?: string;
  source?: string;
  license?: string;
  epoch?: string;
};

let pmtiles: PMTiles;

beforeAll(() => {
  pmtiles = openPMTiles(path);
});

// Pick test stations from the export at runtime — quality filtering means
// specific station ids can come and go between data updates.
const reference = stations.find(
  (s) => s.type === "reference" && s.harmonic_constituents.length > 0,
)!;
const subordinate = stations.find((s) => s.type === "subordinate")!;

async function featuresAt(station: typeof reference, zoom: number) {
  const { x, y } = lonLatToTile(station.longitude, station.latitude, zoom);
  const tile = await pmtiles.getZxy(zoom, x, y);
  return getFeatures(decodeTile(tile!.data));
}

async function featureAt(station: typeof reference, zoom: number) {
  const features = await featuresAt(station, zoom);
  return features.find(
    (f) => (f.properties as StationProperties).id === station.id,
  );
}

describe("metadata", () => {
  it("has the expected header", async () => {
    const header = await pmtiles.getHeader();
    expect(header.minZoom).toBe(0);
    expect(header.maxZoom).toBe(10);
    expect(header.tileType).toBe(1); // MVT
  });

  it("has name, description, and attribution", async () => {
    const metadata = (await pmtiles.getMetadata()) as {
      name?: string;
      description?: string;
      attribution?: string;
    };
    expect(metadata.name).toBe("Neaps Tide Stations");
    expect(metadata.description).toMatch(/@neaps\/tide-database v\d/);
    expect(metadata.attribution).toContain("NOAA");
  });

  it("has a single stations layer spanning all zooms", async () => {
    const metadata = (await pmtiles.getMetadata()) as {
      vector_layers: { id: string; minzoom: number; maxzoom: number }[];
    };
    expect(metadata.vector_layers).toHaveLength(1);
    expect(metadata.vector_layers[0]).toMatchObject({
      id: "stations",
      minzoom: 0,
      maxzoom: 10,
    });
  });
});

describe("lean tiles (z0-7)", () => {
  it("includes every station in the z0 tile", async () => {
    const tile = await pmtiles.getZxy(0, 0, 0);
    const features = getFeatures(decodeTile(tile!.data));
    expect(features).toHaveLength(stations.length);
  });

  it("keeps the z0 tile under 500KB compressed", async () => {
    const tile = await pmtiles.getZxy(0, 0, 0);
    const compressed = gzipSync(Buffer.from(tile!.data));
    expect(compressed.length).toBeLessThan(500_000);
  });

  it("has only lean properties and a hashed feature id", async () => {
    const feature = await featureAt(reference, 0);
    expect(feature).toBeDefined();
    expect(Object.keys(feature!.properties).sort()).toEqual([
      "id",
      "name",
      "type",
    ]);
    expect((feature!.properties as StationProperties).name).toBe(
      reference.name,
    );
    expect(feature!.id).toBe(featureId(reference.id));
  });

  it("does not include full data at z7", async () => {
    const feature = await featureAt(reference, 7);
    expect(feature).toBeDefined();
    expect(feature!.properties).not.toHaveProperty("harmonic_constituents");
    expect(feature!.properties).not.toHaveProperty("datums");
  });
});

describe("full tiles (z8-10)", () => {
  it("round-trips a reference station", async () => {
    const feature = await featureAt(reference, 10);
    expect(feature).toBeDefined();

    const properties = feature!.properties as StationProperties;
    expect(properties.name).toBe(reference.name);
    expect(properties.type).toBe("reference");
    expect(properties.country).toBe(reference.country);
    expect(properties.timezone).toBe(reference.timezone);
    expect(properties.chart_datum).toBe(reference.chart_datum);
    expect(feature!.id).toBe(featureId(reference.id));

    expect(JSON.parse(properties.harmonic_constituents as string)).toEqual(
      reference.harmonic_constituents,
    );
    expect(JSON.parse(properties.datums as string)).toEqual(reference.datums);
    expect(JSON.parse(properties.source as string)).toEqual(reference.source);
    expect(JSON.parse(properties.license as string)).toEqual(reference.license);
  });

  it("round-trips a subordinate station", async () => {
    const feature = await featureAt(subordinate, 10);
    expect(feature).toBeDefined();

    const properties = feature!.properties as StationProperties;
    expect(properties.type).toBe("subordinate");
    expect(JSON.parse(properties.offsets as string)).toEqual(
      subordinate.offsets,
    );
    expect(JSON.parse(properties.harmonic_constituents as string)).toEqual(
      subordinate.harmonic_constituents,
    );
    expect(JSON.parse(properties.datums as string)).toEqual(subordinate.datums);
  });

  it("includes full data starting at z8", async () => {
    const feature = await featureAt(reference, 8);
    expect(feature).toBeDefined();
    expect(feature!.properties).toHaveProperty("harmonic_constituents");
  });
});
