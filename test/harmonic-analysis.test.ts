import { describe, test, expect } from "vitest";
import * as neaps from "@neaps/tide-predictor";
import {
  fitHarmonics,
  parseGeslaSamplesInZone,
  type Sample,
} from "../tools/harmonic-analysis.js";

describe("fitHarmonics", () => {
  test("recovers known amplitude/phase from a synthetic tide", () => {
    // Synthesize 400 days of hourly heights from known constituents using the
    // same Greenwich/nodal convention the fit assumes, then check round-trip.
    const truth = {
      M2: { H: 1.5, G: 110 },
      S2: { H: 0.5, G: 250 },
      O1: { H: 0.3, G: 40 },
    };
    const Z0 = 5;
    const DEG = Math.PI / 180;

    const samples: Sample[] = [];
    const t0 = Date.UTC(2010, 0, 1);
    for (let h = 0; h < 24 * 400; h++) {
      const t = t0 + h * 3600_000;
      const a = neaps.astro(new Date(t));
      let level = Z0;
      for (const [name, { H, G }] of Object.entries(truth)) {
        const con = neaps.constituents[name]!;
        const { f, u } = con.correction(a);
        level += H * f * Math.cos((con.value(a) + u - G) * DEG);
      }
      samples.push({ t, level });
    }

    const fit = fitHarmonics(samples, Object.keys(truth));
    for (const [name, { H, G }] of Object.entries(truth)) {
      const got = fit.find((c) => c.name === name)!;
      expect(got.amplitude).toBeCloseTo(H, 3);
      expect(got.phase).toBeCloseTo(G, 2);
    }
  });
});

describe("parseGeslaSamplesInZone", () => {
  test("converts local wall-clock to UTC across the DST boundary", () => {
    // Two rows in Europe/Berlin: January (MEZ = UTC+1) and July (MESZ = UTC+2).
    const text = [
      "# NULL VALUE -99.9999",
      "#",
      "2020/01/01 12:00:00 1.0 1 1",
      "2020/07/01 12:00:00 2.0 1 1",
    ].join("\n");

    const samples = parseGeslaSamplesInZone(text, "Europe/Berlin");
    expect(samples).toHaveLength(2);
    expect(new Date(samples[0]!.t).toISOString()).toBe(
      "2020-01-01T11:00:00.000Z",
    );
    expect(new Date(samples[1]!.t).toISOString()).toBe(
      "2020-07-01T10:00:00.000Z",
    );
  });
});
