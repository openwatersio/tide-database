#!/usr/bin/env node

/**
 * Evaluates station quality
 *
 * Pipeline:
 *   1. Compute quality factors for all stations
 *   2. Reject stations that fail hard quality gates
 *   3. Deduplicate remaining TICON stations by proximity
 *
 * Output:
 *   tmp/quality.json — all stations with factors and accept/reject status
 *
 * Usage:
 *   node tools/evaluate-quality.ts
 */

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DATA_DIR } from "./station.ts";
import {
  distance,
  getSourceSuffix,
  getSourcePriority,
  hasQualityIssues,
  epochYears,
  MIN_DISTANCE_TO_NOAA,
  MIN_DISTANCE_TICON,
  MIN_TIDAL_RANGE,
} from "./filtering.ts";
import type { StationData } from "../src/types.js";

// ── Types ───────────────────────────────────────────────────────────────

interface Station extends StationData {
  id: string;
}

interface Factors {
  epoch: number;
  source: number;
  quality: boolean;
  datum: boolean;
  range: boolean;
}

interface QualityResult {
  id: string;
  accepted: boolean;
  factors: Factors;
  reason?: string;
  redundant?: string;
}

// Sources superseded by better datasets in this database
const SUPERSEDED_SOURCES = ["noaa", "rws_hist"];

// ── Helpers ──────────────────────────────────────────────────────────────

/** Resolve datums, falling back to the reference station for subordinates. */
function resolveDatums(
  station: Station,
  stationMap: Map<string, Station>,
): Record<string, number> {
  const datums = station.datums ?? {};
  if (Object.keys(datums).length > 0) return datums;
  return stationMap.get(station.offsets?.reference ?? "")?.datums ?? {};
}

function factorSum(f: Factors): number {
  return f.epoch + f.source + +f.quality + +f.datum + +f.range;
}

// ── Scoring (each returns 0–1) ──────────────────────────────────────────

/** Epoch: 0–1. 19 years (full tidal epoch) = 1.0, scales linearly. Resolves subordinate references. */
function scoreEpoch(
  station: Station,
  stationMap: Map<string, Station>,
): number {
  const epoch =
    station.epoch ?? stationMap.get(station.offsets?.reference ?? "")?.epoch;
  const years = epochYears(epoch);
  return Math.min(1, years / 19);
}

/** Source: 0–1. Maps source priority (1 = best, 99 = worst). NOAA = 1.0. Superseded = 0. */
function scoreSource(station: Station): number {
  if (station.id.startsWith("noaa/")) return 1;
  const suffix = getSourceSuffix(station.source.id);
  if (SUPERSEDED_SOURCES.includes(suffix)) return 0;
  const priority = getSourcePriority(station.source.id);
  return Math.max(0, 1 - (priority - 1) / 98);
}

/** No quality control issues flagged. */
function scoreQuality(station: Station): boolean {
  return !hasQualityIssues(station.disclaimers);
}

/** Valid datums (MHW > MSL > MLW). Resolves subordinate references. */
function scoreDatum(
  station: Station,
  stationMap: Map<string, Station>,
): boolean {
  const { MHW, MSL, MLW } = resolveDatums(station, stationMap);
  if (MHW === undefined || MSL === undefined || MLW === undefined) return true;
  return MHW > MSL && MSL > MLW;
}

/** Adequate tidal range (MHW - MLW above threshold). Resolves subordinate references. */
function scoreRange(
  station: Station,
  stationMap: Map<string, Station>,
): boolean {
  const datums = resolveDatums(station, stationMap);
  const high = datums["MHW"] ?? datums["HAT"];
  const low = datums["MLW"] ?? datums["LAT"];

  // Can't evaluate, so pass by default
  if (high === undefined || low === undefined) return true;

  const range = high - low;
  const threshold = MIN_TIDAL_RANGE;
  return range >= threshold;
}

function computeFactors(
  station: Station,
  stationMap: Map<string, Station>,
): Factors {
  return {
    epoch: Math.round(scoreEpoch(station, stationMap) * 1000) / 1000,
    source: Math.round(scoreSource(station) * 1000) / 1000,
    quality: scoreQuality(station),
    datum: scoreDatum(station, stationMap),
    range: scoreRange(station, stationMap),
  };
}

// ── I/O ─────────────────────────────────────────────────────────────────

async function loadAllStations(): Promise<Station[]> {
  const stations: Station[] = [];
  const sources = await readdir(DATA_DIR);

  for (const source of sources) {
    const sourceDir = join(DATA_DIR, source);
    let files: string[];
    try {
      files = await readdir(sourceDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = JSON.parse(
        await readFile(join(sourceDir, file), "utf-8"),
      ) as StationData;
      stations.push({
        ...data,
        id: `${source}/${data.source.id}`,
      });
    }
  }

  return stations;
}

// ── Pipeline steps ───────────────────────────────────────────────────────

const GATES: (keyof Factors)[] = ["source", "datum", "range"];

/** Reject stations that fail hard quality gates (source=0, datum=false, range=false). */
function applyGates(
  stations: Station[],
  factorsMap: Map<string, Factors>,
): { results: QualityResult[]; surviving: Set<string> } {
  const results: QualityResult[] = [];
  const surviving = new Set<string>();

  for (const station of stations) {
    const factors = factorsMap.get(station.id)!;
    const reason = GATES.find((gate) => !factors[gate]);

    if (reason) {
      results.push({ id: station.id, accepted: false, reason, factors });
    } else {
      surviving.add(station.id);
    }
  }

  return { results, surviving };
}

/** Reject TICON stations within MIN_DISTANCE_TO_NOAA of a surviving NOAA station. */
function rejectNearNoaa(
  ticonIds: string[],
  noaaIds: Set<string>,
  stationMap: Map<string, Station>,
  factorsMap: Map<string, Factors>,
): { results: QualityResult[]; rejected: Set<string> } {
  const results: QualityResult[] = [];
  const rejected = new Set<string>();

  for (const ticonId of ticonIds) {
    const ticon = stationMap.get(ticonId)!;
    for (const noaaId of noaaIds) {
      const noaa = stationMap.get(noaaId)!;
      const dist = distance(
        ticon.latitude,
        ticon.longitude,
        noaa.latitude,
        noaa.longitude,
      );
      if (dist <= MIN_DISTANCE_TO_NOAA) {
        results.push({
          id: ticonId,
          accepted: false,
          reason: "near_noaa",
          redundant: noaaId,
          factors: factorsMap.get(ticonId)!,
        });
        rejected.add(ticonId);
        break;
      }
    }
  }

  return { results, rejected };
}

/** Pick winner between two stations: factor sum, then epoch recency, then source priority. */
function pickWinner(
  idA: string,
  idB: string,
  stationMap: Map<string, Station>,
  factorsMap: Map<string, Factors>,
): { winner: string; loser: string } {
  const sumA = factorSum(factorsMap.get(idA)!);
  const sumB = factorSum(factorsMap.get(idB)!);

  if (sumA !== sumB) {
    return sumA > sumB
      ? { winner: idA, loser: idB }
      : { winner: idB, loser: idA };
  }

  // Tiebreaker: prefer more recent epoch end date
  const stationA = stationMap.get(idA)!;
  const stationB = stationMap.get(idB)!;
  const endA = new Date(stationA.epoch?.end ?? 0).getTime();
  const endB = new Date(stationB.epoch?.end ?? 0).getTime();

  if (endA !== endB) {
    return endA > endB
      ? { winner: idA, loser: idB }
      : { winner: idB, loser: idA };
  }

  // Final tiebreaker: source priority (lower number = better)
  const priorityA = getSourcePriority(stationA.source.id);
  const priorityB = getSourcePriority(stationB.source.id);
  return priorityA <= priorityB
    ? { winner: idA, loser: idB }
    : { winner: idB, loser: idA };
}

/** Deduplicate TICON stations by proximity, keeping the highest-quality station. */
function deduplicateTicon(
  ticonIds: string[],
  stationMap: Map<string, Station>,
  factorsMap: Map<string, Factors>,
): QualityResult[] {
  const results: QualityResult[] = [];
  const deduped = new Set<string>();

  for (let i = 0; i < ticonIds.length; i++) {
    const idA = ticonIds[i]!;
    if (deduped.has(idA)) continue;
    const stationA = stationMap.get(idA)!;

    for (let j = i + 1; j < ticonIds.length; j++) {
      const idB = ticonIds[j]!;
      if (deduped.has(idB)) continue;
      const stationB = stationMap.get(idB)!;

      const dist = distance(
        stationA.latitude,
        stationA.longitude,
        stationB.latitude,
        stationB.longitude,
      );
      if (dist > MIN_DISTANCE_TICON) continue;

      const { winner, loser } = pickWinner(idA, idB, stationMap, factorsMap);
      results.push({
        id: loser,
        accepted: false,
        reason: "duplicate",
        redundant: winner,
        factors: factorsMap.get(loser)!,
      });
      deduped.add(loser);
    }
  }

  return results;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading stations...");
  const stations = await loadAllStations();
  const stationMap = new Map(stations.map((s) => [s.id, s]));
  console.log(
    `Loaded ${stations.length} stations (NOAA: ${stations.filter((s) => s.id.startsWith("noaa/")).length}, TICON: ${stations.filter((s) => s.id.startsWith("ticon/")).length})\n`,
  );

  // Step 1: Compute factors
  const factorsMap = new Map<string, Factors>();
  for (const station of stations) {
    factorsMap.set(station.id, computeFactors(station, stationMap));
  }

  // Step 2: Hard rejection gates
  const { results, surviving } = applyGates(stations, factorsMap);

  // Step 3: Deduplicate surviving TICON stations
  const survivingNoaa = new Set(
    [...surviving].filter((id) => id.startsWith("noaa/")),
  );
  const survivingTicon = [...surviving].filter((id) => id.startsWith("ticon/"));

  const nearNoaa = rejectNearNoaa(
    survivingTicon,
    survivingNoaa,
    stationMap,
    factorsMap,
  );
  results.push(...nearNoaa.results);

  const remainingTicon = survivingTicon.filter(
    (id) => !nearNoaa.rejected.has(id),
  );
  results.push(...deduplicateTicon(remainingTicon, stationMap, factorsMap));

  // Collect accepted stations
  const rejectedIds = new Set(results.map((r) => r.id));
  for (const id of surviving) {
    if (rejectedIds.has(id)) continue;
    results.push({ id, accepted: true, factors: factorsMap.get(id)! });
  }

  // Write output
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, "..", "tmp");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "quality.json"),
    JSON.stringify(results, null, 2) + "\n",
  );

  // Summary
  const accepted = results.filter((s) => s.accepted);
  const rejected = results.filter((s) => !s.accepted);
  const reasonCounts: Record<string, number> = {};
  for (const r of rejected) {
    reasonCounts[r.reason!] = (reasonCounts[r.reason!] ?? 0) + 1;
  }

  console.log(
    `Accepted: ${accepted.length} (NOAA: ${accepted.filter((s) => s.id.startsWith("noaa/")).length}, TICON: ${accepted.filter((s) => s.id.startsWith("ticon/")).length})`,
  );
  console.log(`Rejected: ${rejected.length}`);
  for (const [reason, count] of Object.entries(reasonCounts).sort()) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log(`\nWrote tmp/quality.json`);
}

main();
