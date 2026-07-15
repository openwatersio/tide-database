# Off-heap prediction-data pack

Status: **implemented.** Prediction data (harmonic constituents, datums, epoch)
now lives in a `stations.pack` file. The Node build reads only the bytes for the
station being loaded, holding nothing resident; the browser build bundles the
records. The public API is unchanged and still synchronous. The two builds are
selected by `exports` conditions.

## Problem

`src/stations.ts` previously used `import.meta.glob(..., { eager: true })` to
inline **every** station's JSON into the bundle, and any import realized all of
it as live JS objects — even a health check or a single-station lookup.

Measured cost — two symptoms, one cause:

- **CPU:** importing `@neaps/tide-database` was ~358 ms; a warm prediction is
  ~2 ms. On a platform that cold-starts frequently (the tides API burns ~95% of
  its CPU budget), that module evaluation _is_ the bill.
- **Memory:** parsing all 8,290 stations (filtered to ~6,177 quality) into live
  JS objects cost **118 MB of heap / 663 MB RSS** (the predictor is 4 MB — the
  database is all of it). This OOMs memory-constrained devices: signalk-tides
  ([#103](https://github.com/openwatersio/signalk-tides/issues/103)) crashes a
  Victron Cerbo GX with a V8 "Reached heap limit" error, because the 118 MB
  baseline consumes the constrained heap's headroom. The prediction hot loop
  itself does **not** leak — measured flat over 600 iterations (~10 h of runtime).

## Key insight: don't put the data on the heap

The V8 "Reached heap limit" OOM is governed by `heapUsed` vs
`--max-old-space-size`. The previous build kept all 8,290 records as JavaScript
values on that heap. Anything bundled into JavaScript lands there — measured on
the 20 MB pack:

| Form                                      | resident cost                           |
| ----------------------------------------- | --------------------------------------- |
| 8,290 JSON string literals (previous)     | ~69 MB heap                             |
| one base64 string literal, decoded        | ~58 MB heap (OOMs under a 48 MB cap)    |
| **read by byte range from a file** (this) | **~2 MB external**, nothing on the heap |

String and base64 literals live in the module's constant pool — on the heap. So
the data ships as a **file**, and the Node build reads only the record for the
station being loaded (`openSync` once, `readSync` its byte range), holding
nothing resident: the OS page-caches the touched pages and can evict them under
pressure. (`readFileSync`-ing the whole pack into a `Buffer` would also stay off
the V8 heap — Buffers are external memory — but it pins ~20 MB resident; reading
per record avoids even that, so `external` stays ~2 MB.)

## What ships

- **Metadata** — inlined into the JS as object literals via a build macro
  (`createStationMeta`): identity plus `offsets`, `source`, `license`,
  `chart_datum`, etc. Everything except the prediction data.
- **`stations.pack`** — the prediction data (`harmonic_constituents`, `datums`,
  `epoch`) per station, concatenated as UTF-8 JSON records. Shipped as a package
  asset (`dist/node/generated/stations.pack`).
- **A byte-range index** — `id -> [offset, length]` into the pack, generated
  alongside the pack and bundled into the JS (`src/generated/pack-index.ts`), so
  the reader is dependency-free: slice `pack[offset .. offset+length]` →
  `JSON.parse`. Offsets are UTF-8 **bytes** (station names carry multibyte chars).

## Two builds: Node and browser

The package is publicly distributed and may be used in a browser, which has no
filesystem. So the prediction-data source is swapped per build behind the
`#station-data` subpath import:

```jsonc
// package.json
"imports": {
  "#station-data": {
    "browser": "./src/station-data.browser.ts", // bundled JSON strings
    "default": "./src/station-data.ts"           // per-record pack reads (Node)
  }
},
"exports": {
  ".": {
    "browser": "./dist/browser/index.js",
    "node": "./dist/node/index.js",
    "default": "./dist/browser/index.js"
  }
}
```

- **Node** (`station-data.ts`): `openSync` the pack once; `getData(id)` `readSync`s
  only that record's byte range and parses it. Nothing resident — `external` stays
  ~2 MB and the parsed record is transient.
- **Browser** (`station-data.browser.ts`): the records are bundled as JSON strings
  (via the `createStationDataById` macro) and parsed one at a time. This costs
  more heap (the strings are on the JS heap), but browsers have no equivalent of
  Node's tight `--max-old-space-size` limit and no filesystem to read.

Both are **ESM only** and expose the same synchronous `getData(id)`, so
`stations.ts` and everything downstream is identical across builds. tsdown builds
both entries; the browser build never contains `node:fs`. (No CJS build — see
below.)

## The reader and subordinate stations

`stations.ts` builds `allStations` from the metadata, attaching lazy getters for
the prediction fields:

```ts
function makeStation(m: StationMeta): Station {
  // Subordinate stations predict from their reference's data, applying their own
  // offsets; resolve to the reference's record.
  const dataId =
    m.type === "subordinate" && m.offsets ? m.offsets.reference : m.id;
  const station = { ...m } as Station;
  Object.defineProperties(station, {
    harmonic_constituents: {
      enumerable: true,
      get: () => getData(dataId).harmonic_constituents,
    },
    datums: { enumerable: true, get: () => getData(dataId).datums },
    epoch: { enumerable: true, get: () => getData(m.id).epoch },
  });
  return station;
}
```

No caching — a persistent cache on these module-level objects would pull the data
back onto the heap on a process that touches every station. Reading a record is a
`readSync` of its byte range + `JSON.parse` (~µs, and the file is OS-page-cached
after warmup).

## Search indexes (geo + text)

| Index             | Serialized | Built in memory | Used by               | Plan                         |
| ----------------- | ---------- | --------------- | --------------------- | ---------------------------- |
| geo (KDBush)      | ~66 KB     | ~66 KB          | near / nearest / bbox | bundled, eager — negligible  |
| text (MiniSearch) | ~1.5 MB    | ~15 MB          | `search()` only       | built lazily on first search |

`near`/`nearest`/`bbox` resolve coordinates to station ids from the geo index
without touching prediction data. The text index is built on the first `search()`
call, so geo/id-only consumers (like the plugin) never pay its ~15 MB.

## Build pipeline

`npm run build`:

1. `generate` (`scripts/generate-pack.mjs`) — reads `data/**/*.json`, writes
   `src/generated/stations.pack` and `src/generated/pack-index.ts` (both
   git-ignored). A `pretest` hook runs it too, so the tests and both builds always
   have a current pack.
2. `tsdown` — builds `dist/node` and `dist/browser` (both ESM), resolving
   `#station-data` per build.
3. `copy-pack` — copies the pack to `dist/node/generated/` so the runtime
   `new URL("./generated/stations.pack", import.meta.url)` resolves.
4. `tsc --noEmit` — type-checks src and the tests/examples against the built types.
5. `smoke` (`scripts/smoke.mjs`) — imports the built node and browser ESM entries,
   checks a reference and a subordinate station resolve their prediction data, and
   asserts the browser bundle has no `node:fs`. Runs on every build so a broken
   artifact can't ship.

## Results

Node build, import + one `nearest()`, GC'd:

|                           | `heapUsed`  | `external` |
| ------------------------- | ----------- | ---------- |
| eager (before)            | 118 MB      | —          |
| bundled strings (interim) | 69 MB       | —          |
| **per-record pack (now)** | **35.8 MB** | 1.9 MB     |

The remaining ~36 MB is the sync API's own cost — 8,290 `Station` objects plus
full metadata and the id maps — not the prediction data, which is never resident
(`external` is ~2 MB, and touching all 8,290 stations keeps it flat). It
reads all 8,290 stations under `--max-old-space-size=40`; the old build needs
~69 MB just to start. All 31,862 tests pass. The browser build works with the
records bundled and contains no `node:fs`.

Trimming metadata to bare identity (deriving `source.id` from the
`<source>/<source-id>` id, moving `source`/`license`/`offsets` into the pack)
would cut the ~36 MB further, at the cost of extra reads for detail/subordinate
resolution. Left as a future optimization.

## Garbage collection

GC depends on reachability, not on an operation being called "lazy."

- The metadata objects, `allStations`, `stations`, and `stationsById` are
  module-level and live for the process; the pack itself is never held in memory —
  only an open file descriptor and transient per-record read buffers.
- A getter parses one record and returns it. Because getters do not cache, the
  parsed object is collectible once the caller releases it; walking every station
  without retaining results stays flat.
- A bounded LRU cache could be added later if repeated reads ever measure as hot.
  An unbounded `Map` would recreate the original problem by pulling data back onto
  the heap.
- After collection V8 keeps heap pages reserved, so RSS may not fall even though
  the memory is reusable — but the OOM is a heap-limit error, and `heapUsed` is
  what dropped.

## Alternatives considered

| Approach                                                | Verdict                                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Indexed pack file, read per record (`readSync`)         | **Chosen.** Sync API, nothing resident (~2 MB external), one small dependency-free reader.                                                                             |
| Indexed pack file, whole file in a Buffer               | Off-heap too, but pins ~20 MB resident; per-record read avoids it.                                                                                                     |
| Bundle data as JSON string literals (interim "Phase 0") | Works but ~69 MB heap — the strings sit on the heap.                                                                                                                   |
| Bundle data as one base64 literal → Buffer              | Rejected: the base64 literal is on-heap (~58 MB, OOMs under a 48 MB cap).                                                                                              |
| `import.meta.glob({ eager: false })` (dynamic imports)  | Tested: 8 MB baseline, but emits 8,290 chunk files, bundles to ~31 MB on Workers, and the module cache climbs to ~19 MB after 1,000 distinct loads and never releases. |
| SQLite (better-sqlite3 / D1 / sql.js)                   | Overkill for read-only id→blob; native/WASM weight across runtimes.                                                                                                    |
| One large JSON object                                   | Parsing materializes the entire dataset.                                                                                                                               |

## Future: async / edge source

The current design is synchronous and covers Node (off-heap pack file) and the
browser (bundled records). It does **not** need an async API. If a future consumer
wants low memory in an environment with neither a filesystem nor room to bundle
20 MB — e.g. the tides API on Cloudflare Workers pulling records from R2 — the same
pack can be served by HTTP/R2 range reads behind an **async** `getStation(id)`
(a new `@neaps/tide-database/async` entry). That would be additive; it is not
required by the Node or browser builds and is deferred until a consumer needs it.

## ESM only (no CJS build)

`kdbush` and `geokdbush` are ESM-only packages (no `require` export), so a CJS
build can't `require()` them without a double-wrapped-default interop bug
(`KDBush.from is not a function`). All first-party consumers use ESM, so the
package ships **ESM only** — the `require` condition is removed from `exports`.
Modern Node still lets `require()` load the ESM entry (require-of-ESM); older
CJS-only tooling would need to `import()` it.
