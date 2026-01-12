import { describe, test, expect } from "vitest";
import { near, nearest } from "../src/index.js";

describe("near", () => {
  [
    { lat: 44, lon: -67 },
    { lat: 44, lng: -67 },
    { latitude: 44, longitude: -67 },
  ].forEach((coords) => {
    test(Object.keys(coords).join("/"), () => {
      const stations = near(coords);
      expect(stations.length).toBeGreaterThan(0);

      const [station, distance] = stations[0]!;
      expect(station.source.id).toBe("8411801");
      expect(distance).toBeCloseTo(70, 0);
    });
  });

  test("defaults to maxResults=10, maxDistance=Infinity", () => {
    expect(near({ lat: 0, lon: 0 }).length).toBe(10);
  });

  test("can set maxResults", () => {
    const stations = near({ lon: -67, lat: 44, maxResults: 5 });
    expect(stations.length).toBe(5);
  });

  test("can set maxDistance", () => {
    const stations = near({ lon: -67.5, lat: 44.5, maxDistance: 10 });
    expect(stations.length).toBe(1);
  });

  test("can filter results", () => {
    const stations = near({
      lon: -67,
      lat: 44,
      filter: (station) => station.type === "reference",
    });
    expect(stations.length).toBe(10);
    stations.forEach(([station]) => {
      expect(station.type).toBe("reference");
    });
  });
});

describe("nearest", () => {
  test("returns the single nearest station", () => {
    const [station, distance] = nearest({ lon: -75, lat: 23 }) || [];
    expect(station).toBeDefined();
    expect(station!.source.id).toBe("TEC4633");
    expect(distance).toBeCloseTo(11, 0);
  });

  test("returns nearest with filter", () => {
    const [station] =
      nearest({
        lon: -75,
        lat: 23,
        filter: (s) => s.type === "reference" && s.id.startsWith("noaa"),
      }) || [];
    expect(station).toBeDefined();
    expect(station!.source.id).toBe("9710441");
  });

  test("returns null if no stations found", () => {
    expect(nearest({ lon: 0, lat: 0, maxDistance: 1 })).toBe(null);
  });
});
