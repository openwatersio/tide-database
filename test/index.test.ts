import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { stations } from "../src/index.js";

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
  });
});

test("Does not have duplicate stations", () => {
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
