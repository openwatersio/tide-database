// Browser prediction-data source. Selected via the "#station-data" subpath
// import for the browser build (which has no filesystem). The records are
// bundled as JSON strings and parsed one at a time on demand. This costs more
// heap than the Node pack (the strings are on the JS heap), but browsers have no
// equivalent of Node's tight --max-old-space-size limit, and keeping the API
// synchronous matters more than the extra megabytes here.
import { createStationDataById } from "./station-bundle.js" with { type: "macro" };
import type { PredictionData } from "./types.js";

const data: Record<string, string> = createStationDataById();

export function getData(id: string): PredictionData {
  const record = data[id];
  if (!record) throw new Error(`No data record for station ${id}`);
  return JSON.parse(record);
}
