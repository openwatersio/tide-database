# Lazy-loading proposal

Status: **Phase 0 implemented** (see the interim section below); phases 1–5 are
a proposal for discussion.

## Problem

[`src/stations.ts`](../src/stations.ts) uses `import.meta.glob(..., { eager: true })`
to inline **every** station's JSON into the bundle at build time. So
`dist/index.js` is ~23 MB (32.7 MB raw across 8,290 files), and _any_ import of
the package realizes all of it — even a health check or a single-station lookup.

Measured cost — two symptoms, one cause:

- **CPU:** importing `@neaps/tide-database` is ~358 ms; a warm prediction is
  ~2 ms. On a platform that cold-starts frequently (the tides API burns ~95% of
  its CPU budget), that module evaluation _is_ the bill. Caching only helps the
  head of the request distribution; the long tail keeps paying the cold start.
- **Memory:** parsing all 6,085 stations into live JS objects costs **118 MB of
  heap / 663 MB RSS** (the predictor is 4 MB — the database is all of it). This
  OOMs memory-constrained devices: signalk-tides
  ([#103](https://github.com/openwatersio/signalk-tides/issues/103)) crashes a
  Victron Cerbo GX with a V8 "Reached heap limit" error, because the 118 MB
  baseline consumes the constrained heap's headroom. The prediction hot loop
  itself does **not** leak — measured flat over 600 iterations (~10 h of plugin
  runtime).

The fix is to stop loading 8,290 stations to answer a request about one.

## Key insight: metadata is 4.6% of the data

|                                                                                                       | Size        | Loaded                  |
| ----------------------------------------------------------------------------------------------------- | ----------- | ----------------------- |
| Metadata (`id, name, lat, lon, region, country, continent, timezone, type`, + `ref` for subordinates) | **1.49 MB** | eagerly, bundled        |
| Harmonics/datums/offsets/epoch/source/license (the heavy part)                                        | 31.2 MB     | **lazily, per station** |

Everything the search/geo/list endpoints need is in the metadata. Only actual
_prediction_ needs the heavy part, and only for the one (or two) stations
involved. The geo (KDBush) and text (MiniSearch) indexes are already built at
build time and inlined as compact base64 — they stay as-is.

## Data model

Split the station type in two:

```ts
// Bundled for all 8,290 stations (~1.5 MB). Powers search, near, bbox, list,
// and station summaries.
export interface StationMeta {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  region?: string;
  country: string;
  continent: string;
  timezone: string;
  type: "reference" | "subordinate";
  ref?: string; // reference station id, for subordinates
}

// The heavy part, loaded on demand.
export interface StationData {
  /* harmonic_constituents, datums, offsets, ... */
}

// Meta + data, the shape prediction needs. What today's `Station` is.
export type Station = StationMeta & StationData;
```

## Pluggable data source

The heavy data lives somewhere different per runtime, so make the source an
injectable interface with a small set of built-ins:

```ts
export interface StationDataSource {
  get(id: string): Promise<StationData>;
}
```

| Source                | Runtime                       | Backing                                                                                    |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `bundledSource()`     | anywhere (small/offline)      | current eager glob — opt-in, pays the 23 MB                                                |
| `fsSource(dir)`       | Node (Vercel, `neaps-server`) | reads `data/<source>/<id>.json` off disk; the npm package already ships `data/`            |
| `httpSource(baseUrl)` | edge / browser                | `fetch(`${base}/${id}.json`)` from R2 or a release asset — mirrors the gebco tiles pattern |
| `r2Source(bucket)`    | Cloudflare Workers            | `bucket.get(`${id}.json`)` binding                                                         |

The metadata index is always bundled, so `search`/`near`/`bbox`/list stay
synchronous and instant on every runtime. Only heavy loads are async.

## Code sketch

`stations.ts` — bundle metadata, not full stations:

```ts
// Build-time: emit meta only (see "Build" below). Eager, but ~1.5 MB not 23 MB.
import metaList from "../data/stations.meta.json" with { type: "json" };

export const stationsMeta: StationMeta[] = metaList;
export const metaById = new Map(stationsMeta.map((m) => [m.id, m]));
```

A loader that resolves the subordinate→reference wrinkle (2,239 of 8,290
stations borrow their reference's constituents):

```ts
export function createLoader(source: StationDataSource) {
  const cache = new Map<string, Promise<Station>>();

  function load(id: string): Promise<Station> {
    let pending = cache.get(id);
    if (!pending) {
      pending = resolve(id);
      cache.set(id, pending);
    }
    return pending;
  }

  async function resolve(id: string): Promise<Station> {
    const meta = metaById.get(id);
    if (!meta) throw new Error(`Station ${id} not found`);
    const data = await source.get(id);
    // Subordinate stations predict from their reference's harmonics/datums.
    if (meta.type === "subordinate" && meta.ref) {
      const ref = await load(meta.ref);
      return {
        ...meta,
        ...data,
        datums: ref.datums,
        harmonic_constituents: ref.harmonic_constituents,
      };
    }
    return { ...meta, ...data };
  }

  return { load };
}
```

`near`/`search`/`bbox` don't change except their element type becomes
`StationMeta` — they already only touch light fields (they map index ids to
positions/names, never harmonics).

## Consumer ripple

Resolving a station by id becomes **async**. That's the one real cost.

- `neaps`: `findStation(id)` and the coordinate-based prediction entry points
  become `async` (they must load harmonics before predicting). Prediction math
  itself stays sync — `station.getTimelinePrediction(...)` is unchanged once you
  hold a loaded `Station`.
- `@neaps/api`: route handlers already run in Express and can `await`. The
  handlers become `res.json(await station.getTimelinePrediction(...))`.
- `openapi.ts`: today it does `stations.flatMap(...)` at module top level just to
  build the datum enum — that alone forces the full parse. Switch to the fixed
  oceanographic datum list (or derive from metadata), so importing the API no
  longer touches heavy data.

## Build

`tsdown`/vite step emits two things instead of one eager glob:

1. `data/stations.meta.json` — the 1.5 MB metadata array (bundled).
2. The per-station heavy JSON — already exists as `data/<source>/<id>.json`;
   ship it in the npm package (`fsSource`) and/or publish to R2 / a release
   asset (`httpSource`/`r2Source`), stable-named per release like PR #92 does
   for the tileset.

## Versioning

This changes the shape and sync-ness of the public API, so it's a **major**
bump. Migration aids:

- Keep `bundledSource()` so existing offline/sync consumers can opt back into the
  old all-in-memory behavior with one line.
- Export `stationsMeta` (sync, light) as the replacement for most `stations`
  uses (search results, lists, maps) — those never needed harmonics.

## Relationship to the vector tileset (PR #92)

Complementary, not competing. The tileset offloads the **map/search/near**
consumer to the client (rendered from a PMTiles file in R2, zero API CPU). This
proposal fixes the **prediction** path (`/:id/timeline`), which is id-keyed and
can't be served from geo-indexed tiles. Do this first — it removes ~95% of the
API's cold-start cost; ship #92 when you want the map to stop hitting the API at
all.

## Phase 0 (interim): defer parsing, keep the sync API

The full proposal makes station resolution async, which ripples through `neaps`
and `@neaps/api`. That's too slow for the OOM. A smaller change lands first and
fixes the memory crisis without touching the sync contract:

Bundle the heavy data as **unparsed JSON strings** instead of live objects, and
parse one station on first access:

```ts
// Build emits stations.meta.json (parsed eagerly, ~15-20 MB heap) and a
// data map of id -> raw JSON string (kept as strings, ~23 MB, never parsed
// until touched). Vite: import.meta.glob("./**/*.json", { query: "?raw", ... }).
import dataStrings from "../data/stations.data.js"; // { [id]: string }

function attachLazyData(meta: StationMeta): Station {
  let parsed: StationData | undefined;
  const load = () => (parsed ??= JSON.parse(dataStrings[meta.id]));
  return Object.defineProperties(
    { ...meta },
    {
      harmonic_constituents: {
        get: () => resolveHarmonics(meta, load),
        enumerable: true,
      },
      datums: { get: () => resolveDatums(meta, load), enumerable: true },
    },
  );
}
```

`useStation` in the predictor destructures `{ datums, harmonic_constituents }`,
so the getters fire for exactly the one station being predicted — nothing else
parses. `near`/`bbox` read only metadata and never trigger a parse. The
~15 MB MiniSearch text index is also deferred until the first `search()` call,
which geo/id-only consumers (like the plugin) never make.

Measured result (import + one `nearest()`, GC'd): heap **118 MB → 69 MB**
(84 MB once text search is used), all 31,859 tests pass, fully synchronous, a
tide-database-only change (+ rebuild + republish). The heavy data still ships
in the bundle as ~17 MB of strings, so this is the floor for a bundled+offline
database; the async pluggable-source version below is what gets it to ~15 MB and
shrinks the edge bundle. RSS stays high on a machine with abundant RAM (V8 keeps
its peak reservation), but the reported crash is a V8 _heap-limit_ OOM, and
under a configured `--max-old-space-size` the process now stays well within it.

A companion `@neaps/api` change is required: `openapi.ts` builds its datum enum
with `stations.flatMap((s) => Object.keys(s.datums))`, which touches every
station and re-triggers a full parse. tide-database now exports a build-time
`datums` constant for it to import instead.

## Rollout order

0. **(interim, urgent)** Defer parsing — heavy data bundled as strings, parsed
   per station on access. Sync API unchanged. Fixes the OOM.
1. Build emits `stations.meta.json` + keeps per-station files; add
   `stationsMeta` export alongside the existing `stations` (no breakage yet).
2. Add `StationDataSource` + `createLoader`; `fsSource` for Node, `httpSource`
   for edge.
3. Make `neaps` station resolution async; update `@neaps/api` handlers to await.
4. Point the tides API's Worker at `httpSource`/`r2Source`; drop `bundledSource`.
5. Deprecate the eager `stations` export (major bump).
