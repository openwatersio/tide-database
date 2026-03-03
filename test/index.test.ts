import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { stations } from "../src/index.js";
import { near } from "../src/search/index.js";
import { MIN_TIDAL_RANGE, MIN_DEDUP_DISTANCE } from "../tools/filtering.js";

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

    test("has chart_datum", () => {
      expect(
        station.chart_datum,
        `Station ${station.id} is missing chart_datum`,
      ).toBeDefined();

      const { datums } =
        (station.type === "reference"
          ? station
          : stations.find((s) => s.id === station.offsets!.reference)) || {};

      // 3 NOAA stations have empty datums, so we skip the check for those
      if (datums && Object.keys(datums).length > 0) {
        expect(
          datums[station.chart_datum],
          `Station ${station.id} missing chart_datum ${station.chart_datum}`,
        ).toBeDefined();
      }
    });

    if (station.type === "reference") {
      test("has logically ordered datums", () => {
        const datums = station.datums;
        if (!datums || Object.keys(datums).length === 0) return;

        // MHHW/MHW and MLW/MLLW are diurnal-pair averages that converge at weakly
        // diurnal stations, so their relative ordering is not enforced here.
        // MSL and MTL can appear in either order depending on tidal asymmetry,
        // so they are checked independently against their shared bounds.
        const CHAINS = [
          ["MHW", "MSL", "MLW", "LAT"],
          ["MHW", "MTL", "MLW"],
        ] as const;
        for (const chain of CHAINS) {
          for (let i = 0; i < chain.length - 1; i++) {
            const higher = chain[i]!;
            const lower = chain[i + 1]!;
            const h = datums[higher],
              l = datums[lower];
            if (h === undefined || l === undefined) continue;
            expect(
              h,
              `Station ${station.id}: ${higher} (${h.toFixed(3)}m) should be >= ${lower} (${l.toFixed(3)}m)`,
            ).toBeGreaterThanOrEqual(l);
          }
        }
      });
    } else if (station.type === "subordinate") {
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
              `Run tools/evaluate-quality.ts to re-filter.`,
          );
        }
      });

      test("is not too close to NOAA stations", () => {
        const MIN_DISTANCE = MIN_DEDUP_DISTANCE; // stations within this range are always deduped

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
              `Run tools/evaluate-quality.ts to re-filter.`,
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
              `Run tools/evaluate-quality.ts to re-filter.`,
          );
        }
      });

      test("has tidal range >= 2cm (MHW - MLW)", () => {
        if (!station.datums) return;
        const mhw = station.datums["MHW"];
        const mlw = station.datums["MLW"];
        if (mhw === undefined || mlw === undefined) return;
        const range = mhw - mlw;
        expect(
          range,
          `Station ${station.id} has negligible tidal range: ${(range * 100).toFixed(1)}cm (MHW-MLW). ` +
            `Run tools/evaluate-quality.ts to re-filter.`,
        ).toBeGreaterThanOrEqual(MIN_TIDAL_RANGE);
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
