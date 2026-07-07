# Neaps Tide Database - Vector Tiles (PMTiles)

This package generates a [PMTiles](https://docs.protomaps.com/pmtiles/) vector tileset of the Neaps Tide Database for use with [MapLibre GL](https://maplibre.org) and other renderers that read Mapbox Vector Tiles.

> [!WARNING]
> This data is **NOT FOR NAVIGATION**. See the per-station `disclaimers` and `license` properties.

## Usage

Download the latest `neaps.pmtiles` from [releases](https://github.com/openwatersio/tide-database/releases) (the stable URL `https://github.com/openwatersio/tide-database/releases/latest/download/neaps.pmtiles` always points at the newest build) and host it on any static file server or CDN that supports HTTP range requests.

```js
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

maplibregl.addProtocol("pmtiles", new Protocol().tile);

map.addSource("tides", {
  type: "vector",
  url: "pmtiles://https://example.com/neaps.pmtiles",
});

map.addLayer({
  id: "tide-stations",
  type: "circle",
  source: "tides",
  "source-layer": "stations",
  paint: {
    "circle-color": [
      "match",
      ["get", "type"],
      "reference",
      "#1d4ed8",
      "#60a5fa",
    ],
  },
});

map.on("click", "tide-stations", ({ features }) => {
  const station = features[0].properties;
  // Nested objects are encoded as JSON strings (see "Encoding" below)
  const constituents = JSON.parse(station.harmonic_constituents);
  const datums = JSON.parse(station.datums);
  // ... predict tides with @neaps/tide-predictor
});
```

## Tileset structure

A single source-layer named `stations` contains every station as a point feature from zoom 0 through 10 (renderers overzoom beyond that). No stations are ever dropped, but properties vary by zoom to keep tiles small:

- **z0–7 (lean)**: `id`, `name`, `type` — enough to draw and label dots.
- **z8–10 (full)**: everything below. To read full station data, query a tile at z8+.

## Properties

| Property                | Type        | Notes                                          |
| ----------------------- | ----------- | ---------------------------------------------- |
| `id`                    | string      | `<source>/<source_id>`, e.g. `noaa/9414290`    |
| `name`                  | string      |                                                |
| `type`                  | string      | `reference` or `subordinate`                   |
| `country`               | string      | Full country name                              |
| `continent`             | string      |                                                |
| `region`                | string      | Optional                                       |
| `timezone`              | string      | IANA timezone                                  |
| `chart_datum`           | string      | Key into `datums`, e.g. `MLLW`, `LAT`          |
| `disclaimers`           | string      | Optional                                       |
| `datums`                | JSON string | `{ "MLLW": 1.01, "MSL": 2.532, ... }`          |
| `harmonic_constituents` | JSON string | `[{ "name": "M2", "amplitude", "phase" },...]` |
| `offsets`               | JSON string | Subordinate stations only                      |
| `source`                | JSON string | `{ name, id, published_harmonics, url }`       |
| `license`               | JSON string | `{ type, commercial_use, url }`                |
| `epoch`                 | JSON string | Optional; `{ start, end }` dates               |

Vector tile properties only support scalar values, so nested objects are encoded as JSON strings — call `JSON.parse()` on them. Subordinate stations include the `datums` and `harmonic_constituents` of their reference station, so each feature is self-sufficient for prediction.

### Feature ids

Each feature's numeric id is a stable 53-bit [FNV-1a](https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function) hash of the string station `id` (see `features.ts`), usable with MapLibre's [`setFeatureState`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setfeaturestate). Ids are consistent across releases.

## Licensing

Station data licensing varies by source — check each feature's `license` property (e.g. public domain for NOAA, CC BY 4.0 for TICON-4). Attribution is embedded in the tileset metadata.

## Contributing

Building requires Docker (uses the [`ghcr.io/openwatersio/tippecanoe`](https://github.com/openwatersio/tippecanoe) image):

- Build with `npm run build` — generates NDJSON via `build.ts`, runs tippecanoe for the lean (z0–7) and full (z8–10) variants, and merges them with `tile-join` into `dist/neaps.pmtiles`.
- Test with `npm test`.
