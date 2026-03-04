#!/usr/bin/env node

/**
 * Evaluates station quality and produces quality.json
 *
 * Pipeline:
 *   1. Load all stations (NOAA + TICON)
 *   2. Compute quality factors for each station
 *   3. Apply hard gates (datum ordering, tidal range, superseded source)
 *   4. Deduplicate TICON stations by proximity
 *   5. Compute composite score and write results
 *
 * Output:
 *   quality.json — all stations with factors, score, and accept/reject status
 *
 * Usage:
 *   node tools/evaluate-quality.ts
 */

import { readdir, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DATA_DIR } from "./station.ts";
import { NODAL_CYCLE_DAYS } from "./datum.ts";
import {
  distance,
  getSourceSuffix,
  getSourcePriority,
  hasQualityIssues,
  epochYears,
  MAX_DEDUP_DISTANCE,
  MIN_DEDUP_DISTANCE,
  FALLBACK_DEDUP_DISTANCE,
  MIN_AMPLITUDE_RATIO,
  MIN_TIDAL_RANGE,
} from "./filtering.ts";
import type { StationData } from "../src/types.js";

// ── Types ───────────────────────────────────────────────────────────────

interface Station extends StationData {
  id: string;
}

interface Factors {
  epoch: number;
  recency: number;
  source: number;
  quality: number;
  amplitude: number;
  coverage: number;
}

interface QualityResult {
  id: string;
  accepted: boolean;
  score: number;
  factors: Factors;
  issues: string[];
  reason?: string;
  redundant?: string;
}

// Sources superseded by better datasets in this database
const SUPERSEDED_SOURCES = ["noaa", "rws_hist"];

// Weights for composite score (must sum to 100)
const WEIGHTS = {
  epoch: 20,
  recency: 10,
  source: 20,
  quality: 15,
  amplitude: 20,
  coverage: 15,
};

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

/** Get a constituent amplitude by name, or 0 if not present. */
function getAmplitude(station: Station, name: string): number {
  const c = station.harmonic_constituents.find((c) => c.name === name);
  return c?.amplitude ?? 0;
}

function toFixed(n: number, precision = 3): number {
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

/** Detect placeholder epoch dates like 0000-01-01. */
function hasValidEpoch(epoch?: { start: string; end: string }): boolean {
  if (!epoch) return false;
  const startYear = new Date(epoch.start).getFullYear();
  const endYear = new Date(epoch.end).getFullYear();
  // Year 0 or negative years are placeholder/invalid data
  return startYear > 0 && endYear > 0;
}

// ── Gates (pass/fail) ────────────────────────────────────────────────────

/** Check datum ordering. Returns fatal issues (gate failures) and warnings. */
function checkDatumOrdering(
  station: Station,
  stationMap: Map<string, Station>,
): { fatal: string[]; warnings: string[] } {
  const datums = resolveDatums(station, stationMap);
  if (!datums || Object.keys(datums).length === 0)
    return { fatal: [], warnings: [] };

  const fatal: string[] = [];
  const warnings: string[] = [];
  const { MHHW, MHW, MSL, MTL, MLW, MLLW, LAT, HAT } = datums;

  // Core ordering: MHW > MSL > MLW — fatal gate
  if (MHW !== undefined && MSL !== undefined && MHW <= MSL) {
    fatal.push(`MHW (${MHW}) <= MSL (${MSL})`);
  }
  if (MSL !== undefined && MLW !== undefined && MSL <= MLW) {
    fatal.push(`MSL (${MSL}) <= MLW (${MLW})`);
  }
  if (MLW !== undefined && LAT !== undefined && MLW < LAT) {
    fatal.push(`MLW (${MLW}) < LAT (${LAT})`);
  }
  // MHW must exceed MLLW (mean higher high > mean lower low)
  if (MHW !== undefined && MLLW !== undefined && MHW < MLLW) {
    fatal.push(`MHW (${MHW}) < MLLW (${MLLW})`);
  }
  // HAT is the highest possible tide — must be >= mean higher high water
  if (HAT !== undefined && MHHW !== undefined && HAT < MHHW) {
    fatal.push(`HAT (${HAT}) < MHHW (${MHHW})`);
  }

  // MTL between MHW and MLW — fatal gate
  if (MHW !== undefined && MTL !== undefined && MHW < MTL) {
    fatal.push(`MHW (${MHW}) < MTL (${MTL})`);
  }
  if (MTL !== undefined && MLW !== undefined && MTL < MLW) {
    fatal.push(`MTL (${MTL}) < MLW (${MLW})`);
  }

  // Diurnal pairs — warnings only (converge at weakly diurnal stations)
  if (MHHW !== undefined && MHW !== undefined && MHHW < MHW) {
    warnings.push(`MHHW (${MHHW}) < MHW (${MHW})`);
  }
  if (MLW !== undefined && MLLW !== undefined && MLW < MLLW) {
    warnings.push(`MLW (${MLW}) < MLLW (${MLLW})`);
  }

  return { fatal, warnings };
}

/** Check tidal range gate. Returns issue string or null. */
function checkTidalRange(
  station: Station,
  stationMap: Map<string, Station>,
): string | null {
  const datums = resolveDatums(station, stationMap);
  const high = datums["MHW"];
  const low = datums["MLW"];
  if (high === undefined || low === undefined) return null; // can't evaluate
  const range = high - low;
  if (range < MIN_TIDAL_RANGE) {
    return `Tidal range ${(range * 100).toFixed(1)}cm < ${MIN_TIDAL_RANGE * 100}cm threshold`;
  }
  return null;
}

/** Check if source is superseded. */
function checkSuperseded(station: Station): string | null {
  if (!station.id.startsWith("ticon/")) return null;
  const suffix = getSourceSuffix(station.source.id);
  if (SUPERSEDED_SOURCES.includes(suffix)) {
    return `Superseded source: ${suffix}`;
  }
  return null;
}

/** Essential constituents needed for tide prediction. */
const ESSENTIAL_CONSTITUENTS = ["M2", "S2", "K1", "O1"];

/** Check that reference stations have the essential constituents for prediction. */
function checkConstituents(station: Station): string | null {
  if (station.type === "subordinate") return null;

  const names = new Set(station.harmonic_constituents.map((c) => c.name));
  const missing = ESSENTIAL_CONSTITUENTS.filter((c) => !names.has(c));
  if (missing.length > 0) {
    return `Missing constituents for prediction: ${missing.join(", ")}`;
  }

  // A constituent with zero amplitude provides no tidal signal — treat as missing
  const zeroAmplitude = ESSENTIAL_CONSTITUENTS.filter((c) => {
    const constituent = station.harmonic_constituents.find((h) => h.name === c);
    return constituent !== undefined && constituent.amplitude === 0;
  });
  if (zeroAmplitude.length > 0) {
    return `Essential constituents with zero amplitude: ${zeroAmplitude.join(", ")}`;
  }

  // P1 > K1 is physically impossible — P1/K1 ≈ 0.331 in equilibrium theory
  const k1Amp =
    station.harmonic_constituents.find((c) => c.name === "K1")?.amplitude ?? 0;
  const p1Amp =
    station.harmonic_constituents.find((c) => c.name === "P1")?.amplitude ?? 0;
  if (k1Amp > 0 && p1Amp > k1Amp) {
    return `P1 amplitude (${p1Amp.toFixed(4)}) exceeds K1 (${k1Amp.toFixed(4)}): physically impossible`;
  }

  return null;
}

// ── Scored Factors (each returns 0.0–1.0) ────────────────────────────────

/** Epoch: years/19 capped at 1.0. Subordinates inherit from reference.
 *  Stations with placeholder dates (year 0000) get benefit of the doubt. */
function scoreEpoch(
  station: Station,
  stationMap: Map<string, Station>,
): number {
  const epoch =
    station.epoch ?? stationMap.get(station.offsets?.reference ?? "")?.epoch;
  if (epoch && !hasValidEpoch(epoch)) return 1;
  const years = epochYears(epoch);
  return toFixed(Math.min(1, years / (NODAL_CYCLE_DAYS / 365.2425)));
}

/** Recency: how recent is the epoch end date? Stations with data from the
 *  current era score higher. Uses a sigmoid-like curve where data from
 *  ~2000+ scores well, and very old data (pre-1950) scores poorly.
 *  Subordinates inherit from reference.
 *  Stations with placeholder dates (year 0000) get benefit of the doubt. */
function scoreRecency(
  station: Station,
  stationMap: Map<string, Station>,
): number {
  const epoch =
    station.epoch ?? stationMap.get(station.offsets?.reference ?? "")?.epoch;
  if (!epoch?.end) return 0;
  if (!hasValidEpoch(epoch)) return 1;

  const endYear = new Date(epoch.end).getFullYear();
  const currentYear = new Date().getFullYear();
  const age = currentYear - endYear;

  // Linear decay: 0 years old = 1.0, 100+ years old = 0.0
  return toFixed(Math.max(0, Math.min(1, 1 - age / 100)));
}

/** Source confidence: mapped from SOURCE_PRIORITY. */
function scoreSource(station: Station): number {
  const priority = station.id.startsWith("noaa/")
    ? 0
    : getSourcePriority(station.source.id);
  return toFixed(Math.max(0, 1 - priority / 99));
}

/** Quality flags: 1.0 if no issues, 0.0 if flagged. */
function scoreQuality(station: Station): number {
  return hasQualityIssues(station.disclaimers) ? 0 : 1;
}

/** Amplitude plausibility. Start at 1.0, subtract 0.25 per violation. */
function scoreAmplitude(station: Station): { score: number; issues: string[] } {
  // Subordinate stations inherit predictions from their reference
  if (station.type === "subordinate") {
    return { score: 1, issues: [] };
  }

  // If gated out by checkConstituents, this still runs but won't find issues
  if (station.harmonic_constituents.length === 0) {
    return { score: 0, issues: [] };
  }

  let score = 1;
  const issues: string[] = [];

  // Parent/child amplitude ordering (P1>K1 is handled as a fatal gate in checkConstituents)
  const pairs: [string, string][] = [
    ["M2", "N2"],
    ["S2", "K2"],
    ["O1", "Q1"],
  ];

  for (const [parent, child] of pairs) {
    const parentAmp = getAmplitude(station, parent);
    const childAmp = getAmplitude(station, child);
    // Only check if both are present and parent is non-zero
    if (parentAmp > 0 && childAmp > 0 && childAmp > parentAmp) {
      issues.push(
        `${child} amplitude (${childAmp.toFixed(4)}) exceeds ${parent} (${parentAmp.toFixed(4)})`,
      );
      score -= 0.25;
    }
  }

  // Form number sanity: F = (K1+O1)/(M2+S2) should be in (0, 25]
  const m2 = getAmplitude(station, "M2");
  const s2 = getAmplitude(station, "S2");
  const k1 = getAmplitude(station, "K1");
  const o1 = getAmplitude(station, "O1");
  const semidiurnal = m2 + s2;
  const diurnal = k1 + o1;

  if (semidiurnal > 0 && diurnal > 0) {
    const F = diurnal / semidiurnal;
    if (F > 25) {
      issues.push(`Form number ${F.toFixed(2)} exceeds 25`);
      score -= 0.25;
    }
  } else if (semidiurnal === 0 && diurnal === 0) {
    issues.push("No diurnal or semidiurnal constituents with amplitude > 0");
    score -= 0.25;
  }

  return { score: toFixed(Math.max(0, score)), issues };
}

/** Coverage: nearest-neighbor distance. Computed separately (needs all stations). */
function scoreCoverage(station: Station, allStations: Station[]): number {
  let minDist = Infinity;
  for (const other of allStations) {
    if (other.id === station.id) continue;
    const d = distance(
      station.latitude,
      station.longitude,
      other.latitude,
      other.longitude,
    );
    if (d < minDist) {
      minDist = d;
      if (d < 0.001) break; // essentially co-located, no need to keep searching
    }
  }
  return toFixed(Math.min(1, minDist / 50));
}

// ── Composite Score ──────────────────────────────────────────────────────

function computeCompositeScore(factors: Factors): number {
  return Math.round(
    factors.epoch * WEIGHTS.epoch +
      factors.recency * WEIGHTS.recency +
      factors.source * WEIGHTS.source +
      factors.quality * WEIGHTS.quality +
      factors.amplitude * WEIGHTS.amplitude +
      factors.coverage * WEIGHTS.coverage,
  );
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
        id: `${source}/${file.replace(/\.json$/, "")}`,
      });
    }
  }

  return stations;
}

// ── Deduplication ────────────────────────────────────────────────────────

/** Check if two reference stations have similar M2 amplitudes. */
function hasSimilarM2(stationA: Station, stationB: Station): boolean {
  const m2A = stationA.harmonic_constituents.find((c) => c.name === "M2");
  const m2B = stationB.harmonic_constituents.find((c) => c.name === "M2");
  if (!m2A || !m2B || m2A.amplitude <= 0 || m2B.amplitude <= 0) return false;
  const ratio =
    Math.min(m2A.amplitude, m2B.amplitude) /
    Math.max(m2A.amplitude, m2B.amplitude);
  return ratio >= MIN_AMPLITUDE_RATIO;
}

/** Check if two stations are duplicates based on distance and harmonic similarity.
 *
 *  - Within MIN_DEDUP_DISTANCE: always duplicates
 *  - Between MIN_DEDUP_DISTANCE and MAX_DEDUP_DISTANCE: duplicates only if
 *    both are reference stations with similar M2 amplitudes (ratio >= 0.9)
 *  - Beyond MAX_DEDUP_DISTANCE: never duplicates
 */
function areDuplicates(
  stationA: Station,
  stationB: Station,
  dist: number,
  winnerHasSubordinates = false,
): boolean {
  if (dist > MAX_DEDUP_DISTANCE) return false;
  if (dist <= MIN_DEDUP_DISTANCE) return true;

  // For the middle range, require harmonic similarity between reference stations.
  // If the winner has subordinates, also accept a 100m distance fallback — a
  // reference station with dependents should knock out a nearby station even
  // when M2 amplitudes are very small and the ratio falls slightly below 0.9.
  if (stationA.type === "reference" && stationB.type === "reference") {
    if (winnerHasSubordinates && dist <= FALLBACK_DEDUP_DISTANCE) return true;
    return hasSimilarM2(stationA, stationB);
  }

  // Subordinate stations in the middle range: use a tighter distance threshold
  // since we can't compare harmonics
  return dist <= FALLBACK_DEDUP_DISTANCE; // 100m fallback for subordinates
}

/** Count accepted subordinate stations per reference station. */
function countSubordinates(
  stations: Station[],
  resultsMap: Map<string, QualityResult>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const station of stations) {
    if (station.type !== "subordinate") continue;
    if (!resultsMap.get(station.id)!.accepted) continue;
    const ref = station.offsets?.reference;
    if (ref) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  return counts;
}

/** Unified deduplication: for all pairs within range, keep the higher-scoring station.
 *  A reference station with accepted subordinates beats one without, regardless of score. */
function deduplicate(
  stationIds: string[],
  stationMap: Map<string, Station>,
  resultsMap: Map<string, QualityResult>,
  subordinateCounts: Map<string, number>,
): void {
  const rejected = new Set<string>();

  for (let i = 0; i < stationIds.length; i++) {
    const idA = stationIds[i]!;
    if (rejected.has(idA)) continue;
    const stationA = stationMap.get(idA)!;

    for (let j = i + 1; j < stationIds.length; j++) {
      const idB = stationIds[j]!;
      if (rejected.has(idB)) continue;
      const stationB = stationMap.get(idB)!;

      const dist = distance(
        stationA.latitude,
        stationA.longitude,
        stationB.latitude,
        stationB.longitude,
      );

      const scoreA = resultsMap.get(idA)!.score;
      const scoreB = resultsMap.get(idB)!.score;
      const subsA = subordinateCounts.get(idA) ?? 0;
      const subsB = subordinateCounts.get(idB) ?? 0;

      // A reference station with accepted subordinates beats one without
      let winner: string, loser: string;
      if (subsA > 0 && subsB === 0) {
        [winner, loser] = [idA, idB];
      } else if (subsB > 0 && subsA === 0) {
        [winner, loser] = [idB, idA];
      } else {
        [winner, loser] = scoreA >= scoreB ? [idA, idB] : [idB, idA];
      }

      const winnerHasSubs = (subordinateCounts.get(winner) ?? 0) > 0;
      if (!areDuplicates(stationA, stationB, dist, winnerHasSubs)) continue;

      const result = resultsMap.get(loser)!;
      result.accepted = false;
      result.reason = "duplicate";
      result.redundant = winner;
      rejected.add(loser);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading stations...");
  const stations = await loadAllStations();
  const stationMap = new Map(stations.map((s) => [s.id, s]));

  const noaaCount = stations.filter((s) => s.id.startsWith("noaa/")).length;
  const ticonCount = stations.filter((s) => s.id.startsWith("ticon/")).length;
  console.log(
    `Loaded ${stations.length} stations (NOAA: ${noaaCount}, TICON: ${ticonCount})\n`,
  );

  // Step 1: Compute factors and apply gates
  console.log("Computing quality factors...");
  const resultsMap = new Map<string, QualityResult>();

  for (const station of stations) {
    const issues: string[] = [];

    // Gates
    const datumIssues = checkDatumOrdering(station, stationMap);
    const rangeIssue = checkTidalRange(station, stationMap);
    const supersededIssue = checkSuperseded(station);
    const constituentIssue = checkConstituents(station);

    // Diurnal pair warnings are non-fatal
    issues.push(...datumIssues.warnings);

    let gateReason: string | undefined;
    if (datumIssues.fatal.length > 0) {
      issues.push(...datumIssues.fatal);
      gateReason = "datum";
    } else if (rangeIssue) {
      issues.push(rangeIssue);
      gateReason = "range";
    } else if (supersededIssue) {
      issues.push(supersededIssue);
      gateReason = "superseded";
    } else if (constituentIssue) {
      issues.push(constituentIssue);
      gateReason = "constituents";
    }

    // Scored factors
    const amplitudeResult = scoreAmplitude(station);
    issues.push(...amplitudeResult.issues);

    const factors: Factors = {
      epoch: scoreEpoch(station, stationMap),
      recency: scoreRecency(station, stationMap),
      source: scoreSource(station),
      quality: scoreQuality(station),
      amplitude: amplitudeResult.score,
      coverage: 0, // computed in step 2
    };

    const result: QualityResult = {
      id: station.id,
      accepted: !gateReason,
      score: 0, // computed after coverage
      factors,
      issues,
      ...(gateReason ? { reason: gateReason } : {}),
    };

    resultsMap.set(station.id, result);
  }

  // Step 2: Compute coverage (needs all stations)
  console.log("Computing coverage...");
  for (const station of stations) {
    const result = resultsMap.get(station.id)!;
    result.factors.coverage = scoreCoverage(station, stations);
  }

  // Step 3: Compute composite scores
  for (const result of resultsMap.values()) {
    if (result.accepted) {
      result.score = computeCompositeScore(result.factors);
    }
    // Gate failures keep score = 0
  }

  // Step 4: Deduplicate by proximity and harmonic similarity
  console.log("Deduplicating...");
  const survivingIds = stations
    .filter((s) => resultsMap.get(s.id)!.accepted)
    .map((s) => s.id);

  const subordinateCounts = countSubordinates(stations, resultsMap);
  deduplicate(survivingIds, stationMap, resultsMap, subordinateCounts);

  // Collect and sort results
  const results = [...resultsMap.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  // Write output
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outPath = join(__dirname, "..", "quality.json");
  await writeFile(outPath, JSON.stringify(results, null, 2) + "\n");

  // Summary
  const accepted = results.filter((r) => r.accepted);
  const rejected = results.filter((r) => !r.accepted);
  const reasonCounts: Record<string, number> = {};
  for (const r of rejected) {
    reasonCounts[r.reason!] = (reasonCounts[r.reason!] ?? 0) + 1;
  }

  console.log("\n=== Quality Evaluation Summary ===\n");
  console.log(
    `Accepted: ${accepted.length} (NOAA: ${accepted.filter((r) => r.id.startsWith("noaa/")).length}, TICON: ${accepted.filter((r) => r.id.startsWith("ticon/")).length})`,
  );
  console.log(`Rejected: ${rejected.length}`);
  for (const [reason, count] of Object.entries(reasonCounts).sort()) {
    console.log(`  ${reason}: ${count}`);
  }

  // Score distribution
  const scores = accepted.map((r) => r.score);
  scores.sort((a, b) => a - b);
  const p25 = scores[Math.floor(scores.length * 0.25)] ?? 0;
  const p50 = scores[Math.floor(scores.length * 0.5)] ?? 0;
  const p75 = scores[Math.floor(scores.length * 0.75)] ?? 0;
  const min = scores[0] ?? 0;
  const max = scores[scores.length - 1] ?? 0;

  console.log(`\nScore distribution (accepted stations):`);
  console.log(
    `  Min: ${min}  P25: ${p25}  Median: ${p50}  P75: ${p75}  Max: ${max}`,
  );

  // Issues summary
  const stationsWithIssues = results.filter(
    (r) => r.accepted && r.issues.length > 0,
  );
  console.log(`\nAccepted stations with issues: ${stationsWithIssues.length}`);

  console.log(`\nWrote quality.json (${results.length} entries)`);
}

main();
