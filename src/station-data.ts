// Node prediction-data source. Selected via the "#station-data" subpath import
// for the Node build (and by tests). One file handle is held open; each lookup
// reads only that station's byte range from the pack — the file is never loaded
// whole. So the process holds none of the ~6,000 stations' prediction data (the
// OS page-caches the touched pages, which it can evict under memory pressure),
// and the parsed record is transient.
import { openSync, readSync } from "node:fs";
import { packIndex } from "./generated/pack-index.js";
import type { PredictionData } from "./types.js";

const fd = openSync(new URL("./generated/stations.pack", import.meta.url), "r");

export function getData(id: string): PredictionData {
  const range = packIndex[id];
  if (!range) throw new Error(`No data record for station ${id}`);
  const [offset, length] = range;
  const buffer = Buffer.allocUnsafe(length);
  // readSync may return a short read; loop until the whole range is filled so no
  // uninitialized bytes from allocUnsafe reach JSON.parse.
  let read = 0;
  while (read < length) {
    const n = readSync(fd, buffer, read, length - read, offset + read);
    if (n === 0) {
      throw new Error(
        `Short read for station ${id}: ${read} of ${length} bytes`,
      );
    }
    read += n;
  }
  return JSON.parse(buffer.toString("utf8"));
}
