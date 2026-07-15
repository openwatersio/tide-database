# Lazy-loading proposal

Status: **Phase 0 implemented** (see the interim section below). The proposed
next step is a new, **additive** `@neaps/tide-database/async` entry point that
keeps heavy station data out of the JavaScript bundle and in a single indexed
pack file. The existing `@neaps/tide-database` entry is unchanged — this is not a
breaking change.

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
- **Memory:** parsing all 8,290 stations (filtered to ~6,177 quality) into live
  JS objects costs **118 MB of heap / 663 MB RSS** (the predictor is 4 MB — the
  database is all of it). This
  OOMs memory-constrained devices: signalk-tides
  ([#103](https://github.com/openwatersio/signalk-tides/issues/103)) crashes a
  Victron Cerbo GX with a V8 "Reached heap limit" error, because the 118 MB
  baseline consumes the constrained heap's headroom. The prediction hot loop
  itself does **not** leak — measured flat over 600 iterations (~10 h of plugin
  runtime).

The fix is to stop loading 8,290 stations to answer a request about one.

## Key insight: identity is ~3% of the data

Split every station into two tiers:

| Tier              | Fields                                                                         | Size        | Loaded            |
| ----------------- | ------------------------------------------------------------------------------ | ----------- | ----------------- |
| **Slim metadata** | id, name, lat, lon, region, country, continent, timezone, type                 | **~0.9 MB** | bundled, eager    |
| **Heavy pack**    | harmonic_constituents, datums, offsets, epoch, source, license, chart_datum, … | ~32 MB      | pack, per station |

Slim metadata is everything needed to _summarize_ a station in a search result,
nearby list, or map pin. The heavy pack is what you need to _predict_ at a
station or show its full detail — loaded only when the user opens one. (Does the
user need the source license to decide whether to view a station? No — so it
lives in the pack.)

`source.id` is **not** stored: every station id is `<source>/<source-id>` (e.g.
`noaa/8722588`), so it is `id.slice(id.indexOf("/") + 1)`. Verified across all
8,290 stations — every id has that shape and the derived source-id equals the
record's `source.id`. So `findStation` by source id and the text index's
`source.id` field both derive it from the id, with no heavy load and no duplicate
field. The build asserts the invariant. See "Search indexes" below for how the
geo and text indexes fit in.

## Data model

```ts
// Bundled for all ~8,290 stations (~0.9 MB), parsed once. Everything the
// search / near / bbox / list paths need to render a summary.
export interface StationSummary {
  id: string; // "<source>/<source-id>"
  name: string;
  latitude: number;
  longitude: number;
  region?: string;
  country: string;
  continent: string;
  timezone: string;
  type: "reference" | "subordinate";
}

// Loaded from the pack on demand: the full station record.
export interface StationData {
  harmonic_constituents: HarmonicConstituent[];
  datums: Record<string, number>;
  offsets?: { reference: string; height: unknown; time: unknown };
  epoch?: { start: string; end: string };
  source: { id: string; name: string; url: string };
  license: unknown;
  disclaimers: string;
  chart_datum: string;
}

// Summary + data — what prediction and detail views need. Today's `Station`.
export type Station = StationSummary & StationData;
```

The async entry exposes exactly these two halves: `stationsMeta: StationSummary[]`
(bundled) and `getStation(id): Promise<Station>` (loads the pack record). A
consumer that wants the full metadata — license, source, epoch — loads the pack;
a consumer that only lists or maps stations never does.

## Proposed storage: an indexed pack

Ship one `stations.pack` — concatenated UTF-8 JSON records — plus a compact
index (station id → byte offset + length) that is **bundled into the JS**, not
shipped as a separate file:

```text
stations.pack                      # concatenated UTF-8 JSON records (npm asset / R2)
index: Record<id, [offset, len]>   # bundled in the JS entry, ~0.3 MB
```

Bundling the index is what keeps the client dependency-free: there is no `.idx`
format to parse, only `pack[offset .. offset+length]` → `JSON.parse`. For example
the index records that `noaa/9414290` occupies a particular byte range in
`stations.pack`; loading it reads and parses only that range. This avoids both
thousands of installed files and keeping the complete heavy dataset in the JS
heap. (The index and pack are produced by the same build and versioned together,
so they cannot drift — see "Build".)

Do not gzip the complete pack as one stream: retrieving a record near the end
would require decompressing everything before it. Initially, leave the pack
uncompressed. If transfer size later proves important, compress records
individually or divide the file into independently compressed blocks.

The heavy data lives behind a small injectable interface so the same loader can
work in different runtimes:

```ts
export interface StationDataSource {
  get(id: string): Promise<StationData>;
}
```

| Source                  | Runtime                 | Backing                                                   |
| ----------------------- | ----------------------- | --------------------------------------------------------- |
| `packFileSource(path)`  | Node                    | `fs.read()` of the indexed byte range                     |
| `packHttpSource(url)`   | browser / edge          | HTTP Range request for the indexed byte range             |
| `packObjectSource(obj)` | Cloudflare Workers      | R2 range read                                             |
| `bundledSource()`       | anywhere, compatibility | current inlined strings; opt-in and retains the full data |

For HTTP, the server must support byte ranges and return a stable versioned
pack. Browser bundlers have no universal way to serve an npm package asset, so
browser/edge consumers supply the pack URL (an R2 or release-asset URL).

Slim metadata and the index are always bundled, so `search`/`near`/`bbox`/list
stay synchronous and instant on every runtime. Only heavy loads are async.

## Search indexes (geo + text)

The two indexes are very different sizes and handled differently:

| Index             | Serialized | Built in memory | Used by               | Plan                           |
| ----------------- | ---------- | --------------- | --------------------- | ------------------------------ |
| geo (KDBush)      | ~66 KB     | ~66 KB          | near / nearest / bbox | bundle, eager — negligible     |
| text (MiniSearch) | ~1.5 MB    | **~15 MB**      | `search()` only       | build on first search, or skip |

`near`/`nearest`/`bbox` resolve coordinates → station ids from the ~66 KB geo
index with zero heavy loading; you then `getStation` only the one(s) you want.

The text index is the single largest optional cost. A search touches every
station, so it can't be range-read from the pack — it's all-or-nothing.
Therefore it is **built lazily on the first `search()`** (Phase 0 already does
this), and geo/id-only consumers like the plugin never pay it. If even the lazy
15 MB is unwanted, a memory-critical build can drop MiniSearch entirely and do a
linear fuzzy scan over the bundled slim-metadata `name` field — 8,290 names is
small enough to scan interactively at zero extra memory. Its `source.id` field is
derived from the id.

## Code sketch

Slim metadata, bundled:

```ts
// Build-time: emit slim summaries only (see "Build"). Eager, ~0.9 MB.
import summaries from "../data/stations.summary.json" with { type: "json" };

export const stationsMeta: StationSummary[] = summaries;
export const summaryById = new Map(stationsMeta.map((m) => [m.id, m]));
```

A Node pack source needs no database dependency, and holds one open handle:

```ts
export function packFileSource(
  path: string,
  index: PackIndex,
): StationDataSource {
  let fh: Promise<FileHandle> | undefined;
  const handle = () => (fh ??= open(path, "r"));
  return {
    async get(id) {
      const range = index[id];
      if (!range) throw new Error(`Station ${id} not found`);
      const bytes = Buffer.allocUnsafe(range.length);
      await (await handle()).read(bytes, 0, range.length, range.offset);
      return JSON.parse(bytes.toString("utf8"));
    },
    async close() {
      if (fh) await (await fh).close();
    },
  };
}
```

The loader must not retain parsed records by default. It resolves the
subordinate→reference wrinkle using the subordinate's own record, whose
`offsets.reference` names the reference (so no `ref` field is needed in slim
metadata):

```ts
export function createLoader(source: StationDataSource) {
  async function load(id: string): Promise<Station> {
    const meta = summaryById.get(id);
    if (!meta) throw new Error(`Station ${id} not found`);
    const data = await source.get(id); // subordinate: own offsets + empty harmonics
    // Subordinate stations predict from their reference's harmonics/datums,
    // applying their own offsets. One extra read for the reference.
    if (meta.type === "subordinate" && data.offsets?.reference) {
      const ref = await source.get(data.offsets.reference);
      data.harmonic_constituents = ref.harmonic_constituents;
      data.datums = ref.datums;
    }
    return { ...meta, ...data };
  }
  return { load };
}
```

`near`/`search`/`bbox` return `StationSummary` — they already only touch light
fields (they map index ids to positions/names, never harmonics).

## Consumer ripple

Because the async API is a **separate `@neaps/tide-database/async` entry**, the
existing sync exports are untouched; consumers _opt in_ where they want the
low-memory path. Resolving a station by id there is **async** — the one real cost.

- `neaps`: add async variants (or an async build) of `findStation` and the
  coordinate prediction entry points that `await getStation(...)` before
  predicting. The prediction math stays sync once you hold a `Station`. The
  existing sync exports remain for consumers still on the eager entry.
- `@neaps/api`: route handlers already `await`, so they call the async resolver
  directly — `res.json(await getTimelinePrediction(...))`.
- `openapi.ts`: **done in Phase 0** — it imports the build-time `datums` constant
  (exported by this package) instead of scanning every station's datums, which
  previously forced the whole database to parse at module load.

## Build

The build emits:

1. **Slim summaries** — `StationSummary[]`, bundled into the JS entry (~0.9 MB).
2. **A byte-range index** — id → `{ offset, length }`, bundled into the JS
   (~0.3 MB), produced by the same pass that writes the pack so the two can't
   drift.
3. **`stations.pack`** — the heavy JSON records concatenated in deterministic
   station-id order, shipped as an npm asset and/or published to R2 / a stable
   release asset.

Offsets are measured in **UTF-8 bytes**, not JS string lengths (station names
carry accents). The build must (a) assert every id is `<source>/<source-id>` and
that the derived source-id equals the record's `source.id` (the invariant the
`source.id` derivation relies on), and (b) read every indexed record back and
parse it to verify the index.

## Garbage collection

Garbage collection depends on reachability, not whether an operation is called
"lazy."

In Phase 0, module-level exports retain `meta`, `allStations`, `stations`,
`stationsById`, and the complete `heavy: string[]` for the lifetime of the
module. Accessing a getter parses one heavy JSON string. Because the getter does
not cache its result, the parsed harmonics/datums can be collected after the
caller releases them; the original JSON string cannot, because `heavy` still
references it. If a consumer walks every station but does not retain the getter
results, the temporary parsed objects are collectible.

JavaScript modules themselves are cached and normally cannot be unloaded from a
running process or realm. Dynamically importing one JSON module per station
therefore does not provide reliable eviction: every imported JSON module may
remain in the module cache.

With the pack source, the read buffer and parsed station can be collected once
the caller releases the returned station, provided the loader does not cache
it. An optional bounded LRU cache can be added later if measurements show that
repeated reads matter. An unbounded `Map` would eventually recreate the current
memory problem.

After collection, V8 commonly keeps heap pages reserved for future allocations,
so RSS may not fall even though the memory is reusable and no longer counts as
live objects.

## Alternatives considered

| Format                                                  | Lazy lookup                         | Assessment                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indexed JSON pack                                       | Yes                                 | Recommended: smallest portable implementation                                                                                                                                          |
| SQLite                                                  | Yes                                 | Excellent for Node, but adds native/WASM and HTTP-VFS complexity across runtimes                                                                                                       |
| ZIP, one entry per station                              | Yes                                 | Works, but needs ZIP parsing and its central directory; little benefit over the pack                                                                                                   |
| TAR                                                     | Only with a separate index          | The custom index is still needed, so use the simpler pack layout                                                                                                                       |
| CBOR/MessagePack records                                | Yes, with offsets                   | Potentially smaller, but adds a codec before JSON has proved inadequate                                                                                                                |
| One large JSON object                                   | No                                  | Parsing normally materializes the entire dataset                                                                                                                                       |
| Dynamic JSON imports (`import.meta.glob` `eager:false`) | Loads on demand, but does not evict | Tested: 8 MB baseline, but emits 8,290 chunk files, bundles to ~31 MB on Workers (over the limit), and the module cache climbs to ~19 MB after 1,000 distinct loads and never releases |

PMTiles remains appropriate for geographic/map access, but it is awkward as the
canonical id-keyed prediction store.

## Versioning

The async API ships as a new `@neaps/tide-database/async` subpath export, so the
main entry and its `stations`/`search`/prediction exports are unchanged — this is
an **additive minor**, not a breaking major. Consumers migrate at their own pace
by importing `/async`. The eager entry keeps its Phase 0 behavior indefinitely
for offline/sync use; there is no forced deprecation.

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
parse one station when its heavy fields are accessed:

```ts
// Build-time macros inline metadata objects and one raw JSON string per station.
import dataStrings from "../data/stations.data.js";

function attachLazyData(meta: StationMeta): Station {
  const load = () => JSON.parse(dataStrings[meta.id]);
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
(84 MB once text search is used), all 31,862 tests pass, fully synchronous, a
tide-database-only change (+ rebuild + republish). The heavy data still ships in
the bundle as ~17 MB of strings, so this is the floor for a bundled+offline
database. The async pack entry below drops the resident data entirely: its at-rest
footprint is slim metadata (~0.9 MB → ~10 MB heap) + geo index (~66 KB) + byte
index (~0.3 MB), i.e. **~10–15 MB**, with heavy data read from the pack on demand
and text search's 15 MB only if used. RSS stays high on a machine with abundant
RAM (V8 keeps its peak reservation), but the reported crash is a V8 _heap-limit_
OOM, and under a configured `--max-old-space-size` the process stays well within
it.

A companion `@neaps/api` change is required: `openapi.ts` builds its datum enum
with `stations.flatMap((s) => Object.keys(s.datums))`, which touches every
station and re-triggers a full parse. tide-database now exports a build-time
`datums` constant for it to import instead.

## Rollout order

0. **(done)** Phase 0 — defer parsing; heavy data bundled as strings, parsed per
   station on access. Sync API unchanged. Fixes the OOM.
1. Build emits slim summaries, the bundled byte-range index, and `stations.pack`.
2. Add the `@neaps/tide-database/async` entry: `stationsMeta`, `getStation`,
   async `near`/`nearest`/`bbox`/`search`, `StationDataSource` + `createLoader`,
   `packFileSource` (Node) and range-request sources (browser/edge).
3. `neaps`: add async resolution that `await`s `getStation`; `@neaps/api`
   handlers call it. The existing sync entry stays untouched.
4. Point the tides API's Worker at `packHttpSource`/`packObjectSource`; signalk
   uses `packFileSource` (offline).
