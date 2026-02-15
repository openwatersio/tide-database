import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { stations } from "../src/index.js";
import { near } from "../src/search/index.js";

const ROOT = new URL("..", import.meta.url).pathname;
const SCHEMA_PATH = join(ROOT, "schemas", "station.schema.json");

const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf-8"));
const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
(addFormats as any)(ajv);
const validate = ajv.compile(schema);

stations.forEach((station) => {
  describe(station.id, () => {
    test("is valid", () => {
      const valid = validate(station);
      if (!valid)
        throw new Error(
          ajv.errorsText(validate.errors) +
            `\n${JSON.stringify(validate.errors, null, 2)}`,
        );
    });

    if (station.type === "subordinate") {
      test("has valid reference station", () => {
        const id = station.offsets!.reference;
        const reference = stations.find((s) => s.id === id);
        expect(reference, `Unknown reference station: ${id}`).toBeDefined();
      });
    }

    if (station.id.startsWith("ticon/")) {
      test("has no exact duplicate coordinates with other TICON stations", () => {
        const nearby = near({
          latitude: station.latitude,
          longitude: station.longitude,
          maxDistance: 0.001, // 1 meter
          maxResults: Infinity,
          filter: (s) => s.id.startsWith("ticon/") && s.id !== station.id,
        });

        if (nearby.length > 0) {
          const [other, dist] = nearby[0]!;
          throw new Error(
            `This TICON station has duplicate/very close coordinates with ${other.id}: ` +
              `${(dist * 1000).toFixed(0)}m apart. ` +
              `Run tools/deduplicate-stations.ts to remove duplicates.`,
          );
        }
      });

      test("is not too close to NOAA stations", () => {
        const MIN_DISTANCE = 0.1; // 100 meters (in km)

        const nearby = near({
          latitude: station.latitude,
          longitude: station.longitude,
          maxDistance: MIN_DISTANCE,
          maxResults: Infinity,
          filter: (s) => s.id.startsWith("noaa/"),
        });

        if (nearby.length > 0) {
          const [noaa, dist] = nearby[0]!;
          throw new Error(
            `This TICON station is ${(dist * 1000).toFixed(0)}m from NOAA station ${noaa.id}. ` +
              `Minimum distance is ${MIN_DISTANCE * 1000}m. ` +
              `Run tools/deduplicate-stations.ts to remove duplicates.`,
          );
        }
      });

      test("maintains minimum distance from other TICON stations", () => {
        const MIN_DISTANCE = 0.05; // 50 meters (in km)

        const nearby = near({
          latitude: station.latitude,
          longitude: station.longitude,
          maxDistance: MIN_DISTANCE,
          maxResults: Infinity,
          filter: (s) => s.id.startsWith("ticon/") && s.id !== station.id,
        });

        if (nearby.length > 0) {
          const [other, dist] = nearby[0]!;
          throw new Error(
            `This TICON station is only ${(dist * 1000).toFixed(0)}m from ${other.id} ` +
              `(minimum: ${MIN_DISTANCE * 1000}m). ` +
              `Run tools/deduplicate-stations.ts to remove duplicates.`,
          );
        }
      });
    }
  });
});

test("Does not have duplicate source IDs", () => {
  const seen = new Map();
  stations.forEach((station) => {
    const dup = seen.get(station.source.id);
    if (dup) {
      throw new Error(
        `Stations ${station.id} and ${dup.id} have the same source id ${station.source.id}`,
      );
    }
    seen.set(station.source.id, station);
  });
});
