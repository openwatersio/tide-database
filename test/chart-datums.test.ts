import { describe, test, expect } from "vitest";
import { computeDatums } from "../tools/datum.js";
import { isBaltic } from "../tools/sea-regions.js";
import { getChartDatum, pruneDatums } from "../tools/station.js";

const CONSTITUENTS = [
  { name: "M2", amplitude: 1.0, phase: 0 },
  { name: "S2", amplitude: 0.3, phase: 0 },
  { name: "K1", amplitude: 0.2, phase: 0 },
  { name: "O1", amplitude: 0.1, phase: 0 },
];

describe("computeDatums — extra chart datums", () => {
  const { datums } = computeDatums(CONSTITUENTS, {});

  test("MHWS/MLWS follow the Admiralty springs approximation (MSL ± (M2+S2))", () => {
    expect(datums["MHWS"]).toBeCloseTo(1.3, 3);
    expect(datums["MLWS"]).toBeCloseTo(-1.3, 3);
  });

  test("NLLW and ALLW are the ISLW value (MSL − (M2+S2+K1+O1)), both present and equal", () => {
    expect(datums["NLLW"]).toBeCloseTo(-1.6, 3);
    expect(datums["ALLW"]).toBe(datums["NLLW"]);
  });

  test("LLWLT is a low-water datum near LAT", () => {
    const { LLWLT, LAT, MLW } = datums;
    expect(LLWLT).toBeDefined();
    expect(LLWLT!).toBeLessThan(MLW!);
    // Mean of annual lows sits at or a touch above the single lowest tide.
    expect(LLWLT!).toBeGreaterThanOrEqual(LAT! - 0.05);
  });

  test("TLT is defined and a low, sub-MSL datum", () => {
    expect(datums["TLT"]).toBeDefined();
    expect(datums["TLT"]!).toBeLessThan(0);
    expect(datums["TLT"]!).toBeGreaterThanOrEqual(-1.6); // can't exceed the summed amplitudes
  });

  test("no NaN datums are emitted", () => {
    for (const v of Object.values(datums))
      expect(Number.isFinite(v)).toBe(true);
  });
});

describe("isBaltic", () => {
  const cases: [string, number, number, boolean][] = [
    ["Norderney (North Sea)", 53.7, 7.15, false],
    ["Cuxhaven (North Sea)", 53.87, 8.72, false],
    ["Glückstadt / Elbe (North Sea)", 53.79, 9.42, false],
    ["Flensburg (Baltic)", 54.8, 9.43, true],
    ["Kiel (Baltic)", 54.32, 10.14, true],
    ["Warnemünde (Baltic)", 54.18, 12.08, true],
    ["Gothenburg (Kattegat)", 57.68, 11.95, true],
    ["Stockholm (Baltic)", 59.32, 18.08, true],
    ["Esbjerg DK (North Sea)", 55.47, 8.44, false],
  ];
  for (const [name, lat, lon, expected] of cases) {
    test(`${name} → ${expected ? "Baltic" : "not Baltic"}`, () => {
      expect(isBaltic(lat, lon)).toBe(expected);
    });
  }
});

describe("getChartDatum", () => {
  const all = {
    MSL: 0,
    MLW: -1,
    MLLW: -1.2,
    MLWS: -1.3,
    LAT: -1.6,
    LLWLT: -1.5,
    NLLW: -1.6,
    ALLW: -1.6,
    TLT: -1.55,
  };

  test("US → MLLW", () => {
    expect(getChartDatum("United States", all, 40, -74)).toBe("MLLW");
  });
  test("Canada → LLWLT", () => {
    expect(getChartDatum("Canada", all, 49, -123)).toBe("LLWLT");
  });
  test("unlisted country → LAT", () => {
    expect(getChartDatum("United Kingdom", all, 51, 0)).toBe("LAT");
  });
  test("Baltic location → MSL regardless of country", () => {
    // A German Baltic station (Kiel) overrides the country default.
    expect(getChartDatum("Germany", all, 54.32, 10.14)).toBe("MSL");
  });
  test("German North Sea station → LAT (not overridden)", () => {
    expect(getChartDatum("Germany", all, 53.87, 8.72)).toBe("LAT");
  });
  test("falls back to LAT when the preferred datum is absent", () => {
    const noLlwlt = { MSL: 0, MLW: -1, LAT: -1.6 };
    expect(getChartDatum("Canada", noLlwlt, 49, -123)).toBe("LAT");
  });
});

describe("pruneDatums", () => {
  const full = { MSL: 0, MLWS: -1.3, LLWLT: -1.5, TLT: -1.55, NLLW: -1.6 };
  test("keeps standard datums, drops other countries' bespoke datums", () => {
    const canada = pruneDatums("Canada", full);
    expect(canada["LLWLT"]).toBeDefined();
    expect(canada["MLWS"]).toBeDefined();
    expect(canada["TLT"]).toBeUndefined();
    expect(canada["NLLW"]).toBeUndefined();
  });
  test("a non-owning country keeps only the standard datums", () => {
    const uk = pruneDatums("United Kingdom", full);
    expect(uk["MSL"]).toBeDefined();
    expect(uk["MLWS"]).toBeDefined();
    expect(uk["LLWLT"]).toBeUndefined();
    expect(uk["TLT"]).toBeUndefined();
    expect(uk["NLLW"]).toBeUndefined();
  });
});
