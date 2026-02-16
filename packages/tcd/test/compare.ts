/**
 * Utilities for comparing tide predictions from different sources.
 */

import type { TideEvent } from "./xtide.js";

export interface ComparisonResult {
  matched: number;
  unmatched: number;
  timeDiffMinutes: {
    mean: number;
    max: number;
    min: number;
    stdDev: number;
  };
  heightDiffMeters: {
    mean: number;
    max: number;
    min: number;
    stdDev: number;
    rmse: number;
  };
  details: Array<{
    expected: TideEvent;
    actual: TideEvent | null;
    timeDiffMinutes: number;
    heightDiffMeters: number;
  }>;
}

/**
 * Find the closest matching event in the actual predictions for each expected event.
 * Events must match on type (high/low) and be within a reasonable time window.
 */
function matchEvents(
  expected: TideEvent[],
  actual: TideEvent[],
  maxTimeDiffMinutes: number = 60,
): Array<{ expected: TideEvent; actual: TideEvent | null }> {
  const matches: Array<{ expected: TideEvent; actual: TideEvent | null }> = [];
  const usedActual = new Set<number>();

  for (const exp of expected) {
    let bestMatch: TideEvent | null = null;
    let bestTimeDiff = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < actual.length; i++) {
      if (usedActual.has(i)) continue;

      const act = actual[i]!;

      // Must match type (high/low)
      if (act.type !== exp.type) continue;

      // Calculate time difference in minutes
      const timeDiffMs = Math.abs(act.time.getTime() - exp.time.getTime());
      const timeDiffMinutes = timeDiffMs / (1000 * 60);

      // Skip if outside reasonable window
      if (timeDiffMinutes > maxTimeDiffMinutes) continue;

      // Take the closest match
      if (timeDiffMinutes < bestTimeDiff) {
        bestMatch = act;
        bestTimeDiff = timeDiffMinutes;
        bestIndex = i;
      }
    }

    if (bestMatch && bestIndex >= 0) {
      usedActual.add(bestIndex);
    }

    matches.push({ expected: exp, actual: bestMatch });
  }

  return matches;
}

/**
 * Calculate mean of an array of numbers.
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation of an array of numbers.
 */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
  return Math.sqrt(mean(squaredDiffs));
}

/**
 * Calculate root mean square error (RMSE).
 */
function rmse(values: number[]): number {
  if (values.length === 0) return 0;
  const squaredValues = values.map((v) => v * v);
  return Math.sqrt(mean(squaredValues));
}

/**
 * Compare two sets of tide predictions and calculate error metrics.
 *
 * @param expected - Expected predictions (baseline/reference)
 * @param actual - Actual predictions (to validate)
 * @param maxTimeDiffMinutes - Maximum time difference for matching events (default: 60 minutes)
 * @returns Comparison result with error metrics
 */
export function comparePredictions(
  expected: TideEvent[],
  actual: TideEvent[],
  maxTimeDiffMinutes: number = 60,
): ComparisonResult {
  const matches = matchEvents(expected, actual, maxTimeDiffMinutes);

  const details = matches.map(({ expected, actual }) => {
    const timeDiffMinutes = actual
      ? Math.abs(actual.time.getTime() - expected.time.getTime()) / (1000 * 60)
      : NaN;
    const heightDiffMeters = actual ? actual.height - expected.height : NaN;

    return {
      expected,
      actual,
      timeDiffMinutes,
      heightDiffMeters,
    };
  });

  // Filter to only matched events for stats
  const matched = details.filter((d) => d.actual !== null);
  const timeDiffs = matched.map((d) => d.timeDiffMinutes);
  const heightDiffs = matched.map((d) => d.heightDiffMeters);

  return {
    matched: matched.length,
    unmatched: expected.length - matched.length,
    timeDiffMinutes: {
      mean: mean(timeDiffs),
      max: Math.max(...timeDiffs, 0),
      min: Math.min(...timeDiffs, 0),
      stdDev: stdDev(timeDiffs),
    },
    heightDiffMeters: {
      mean: mean(heightDiffs),
      max: Math.max(...heightDiffs, 0),
      min: Math.min(...heightDiffs, 0),
      stdDev: stdDev(heightDiffs),
      rmse: rmse(heightDiffs),
    },
    details,
  };
}

/**
 * Format comparison result as a human-readable string.
 */
export function formatComparisonResult(result: ComparisonResult): string {
  const lines: string[] = [];

  lines.push(
    `Matched events: ${result.matched}/${result.matched + result.unmatched}`,
  );
  lines.push("");
  lines.push("Time differences (minutes):");
  lines.push(`  Mean: ${result.timeDiffMinutes.mean.toFixed(2)}`);
  lines.push(`  Max: ${result.timeDiffMinutes.max.toFixed(2)}`);
  lines.push(`  Min: ${result.timeDiffMinutes.min.toFixed(2)}`);
  lines.push(`  Std Dev: ${result.timeDiffMinutes.stdDev.toFixed(2)}`);
  lines.push("");
  lines.push("Height differences (meters):");
  lines.push(`  Mean: ${result.heightDiffMeters.mean.toFixed(4)}`);
  lines.push(`  Max: ${result.heightDiffMeters.max.toFixed(4)}`);
  lines.push(`  Min: ${result.heightDiffMeters.min.toFixed(4)}`);
  lines.push(`  Std Dev: ${result.heightDiffMeters.stdDev.toFixed(4)}`);
  lines.push(`  RMSE: ${result.heightDiffMeters.rmse.toFixed(4)}`);

  return lines.join("\n");
}
