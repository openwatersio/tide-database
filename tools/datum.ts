import {
  createTidePredictor,
  type TidePredictionOptions,
  type HarmonicConstituent,
} from "@neaps/tide-predictor";

export interface EpochSpec {
  end?: Date;
}

/** A single water-level point. `Extreme` from the predictor is assignable to this. */
export interface Sample {
  time: Date;
  level: number;
}

export type Datums = Record<string, number>;

export interface TidalDatumsResult {
  start: Date;
  end: Date;
  datums: Datums;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** One full lunar nodal cycle (6798.383 days = 18.6130 years) */
export const NODAL_CYCLE_DAYS = 6798.383;
const NODAL_CYCLE_MS = NODAL_CYCLE_DAYS * DAY_MS;
/** M2 angular speed (°/hr) — principal lunar semi-diurnal constituent */
const M2_SPEED = 28.9841042;
/** Mean tidal day: two M2 cycles (hours) */
const M2_TIDAL_DAY_HOURS = (360 / M2_SPEED) * 2;

/**
 * Resolve an EpochSpec to explicit start/end Dates.
 *
 * Always uses exactly one 18.6-year nodal cycle ending at `end`, regardless
 * of the actual observation period. Datums computed over less than a full
 * nodal cycle are inaccurate because they don't capture the full range of
 * lunar node variation.
 */
export function resolveEpoch({ end = new Date() }: EpochSpec): {
  start: Date;
  end: Date;
} {
  const start = new Date(end.getTime() - NODAL_CYCLE_MS);
  return { start, end };
}

/**
 * Core helper: given a regular timeline of {time, level}, compute datums.
 *
 * `msl` is the mean sea level to report (mean of all hourly heights, per NOAA
 * CO-OPS handbook §3.1). It only sets the returned MSL field; every other datum
 * stays in the input series' native frame. Synthetic (constituent) callers leave
 * it 0; observed callers pass the mean of the hourly series.
 */
function computeDatumsFromExtremes(extremes: Sample[], msl = 0): Datums {
  const allHighs: number[] = [];
  const allLows: number[] = [];
  const higherHighs: number[] = [];
  const lowerLows: number[] = [];

  const tidalDayMs = M2_TIDAL_DAY_HOURS * 60 * 60 * 1000;
  const times = extremes.map((pt) => pt.time);
  const heights = extremes.map((pt) => pt.level);

  if (times.length === 0) {
    throw new Error("times array is empty");
  }
  const firstTime = times[0];
  const lastTime = times[times.length - 1];
  if (!firstTime || !lastTime) {
    throw new Error("times array is empty");
  }

  let dayStartTime = firstTime.getTime();
  let idx = 0;
  let daysWithHighs = 0;
  let daysWithLows = 0;

  while (dayStartTime < lastTime.getTime()) {
    const dayEndTime = dayStartTime + tidalDayMs;

    const idxStart = idx;
    while (idx < times.length && times[idx]!.getTime() < dayEndTime) {
      idx++;
    }
    const idxEnd = idx;

    if (idxEnd - idxStart >= 3) {
      const highs: number[] = [];
      const lows: number[] = [];

      for (let i = idxStart + 1; i < idxEnd - 1; i++) {
        const hPrev = heights[i - 1];
        const hCurr = heights[i];
        const hNext = heights[i + 1];

        if (
          hCurr !== undefined &&
          hPrev !== undefined &&
          hNext !== undefined &&
          hCurr >= hPrev &&
          hCurr >= hNext &&
          (hCurr > hPrev || hCurr > hNext)
        ) {
          highs.push(hCurr);
        } else if (
          hCurr !== undefined &&
          hPrev !== undefined &&
          hNext !== undefined &&
          hCurr <= hPrev &&
          hCurr <= hNext &&
          (hCurr < hPrev || hCurr < hNext)
        ) {
          lows.push(hCurr);
        }
      }

      if (highs.length > 0) {
        daysWithHighs++;
        allHighs.push(...highs);
        highs.sort((a, b) => a - b);
        // higher high
        const hhVal = highs[highs.length - 1];
        if (hhVal !== undefined) {
          higherHighs.push(hhVal);
        }
      }

      if (lows.length > 0) {
        daysWithLows++;
        allLows.push(...lows);
        lows.sort((a, b) => a - b);
        // lower low
        const llVal = lows[0];
        if (llVal !== undefined) {
          lowerLows.push(llVal);
        }
      }
    }

    dayStartTime += tidalDayMs;

    // ensure idx keeps up
    while (idx < times.length && times[idx]!.getTime() < dayStartTime) {
      idx++;
    }
  }

  const mhw = mean(allHighs);
  const mlw = mean(allLows);

  return {
    // max/min loop instead of Math.max(...heights): observed series have 100k+
    // points and the spread overflows the call stack.
    HAT: toFixed(max(heights), 3),
    MHHW: toFixed(mean(higherHighs), 3),
    MHW: toFixed(mhw, 3),
    // MSL = mean of hourly heights (NOAA CO-OPS handbook §3.1). 0 for synthetic
    // constituent series; the observed mean for real water-level series.
    MSL: toFixed(msl, 3),
    MTL: toFixed((mhw + mlw) / 2, 3),
    MLW: toFixed(mlw, 3),
    MLLW: toFixed(mean(lowerLows), 3),
    LAT: toFixed(min(heights), 3),
  };
}

/**
 * Use @neaps/tide-predictor to synthesize a multi-year tidal timeline
 * for a given set of constituents, and compute tidal datums from it.
 */
export function computeDatums(
  constituents: HarmonicConstituent[],
  epochSpec: EpochSpec,
  tidePredictorOptions: TidePredictionOptions = {},
): TidalDatumsResult {
  const { start, end } = resolveEpoch(epochSpec);

  // Build predictor from @neaps/tide-predictor
  const predictor = createTidePredictor(constituents, tidePredictorOptions);

  // Get extremes over the epoch
  const extremes = predictor.getExtremesPrediction({
    start,
    end,
  });

  return {
    start,
    end,
    datums: computeDatumsFromExtremes(extremes),
  };
}

/** Minimum record span (days) and hourly-point count to derive datums from observations. */
const MIN_DATUM_DAYS = 365;
const MIN_HOURLY_POINTS = 4000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Parse a GESLA-4 station file into UTC water-level samples.
 *
 * Keeps only rows flagged use-in-analysis (`use_flag === 1`, which already
 * excludes QC spikes/doubtful/missing) and drops the -99.9999 null. Times are
 * converted to UTC using the header's `TIME ZONE HOURS` (expected 0 for GESLA-4,
 * honored defensively).
 */
export function parseGeslaSamples(text: string): Sample[] {
  const lines = text.split(/\r?\n/);

  let tzHours = 0;
  let nullValue = -99.9999; // GESLA-4 default; overridden by the header below
  for (const line of lines) {
    if (!line.startsWith("#")) break;
    const tz = line.match(/^#\s*TIME ZONE HOURS\s+(-?\d+(?:\.\d+)?)/);
    if (tz) tzHours = parseFloat(tz[1]!);
    const nv = line.match(/^#\s*NULL VALUE\s+(-?\d+(?:\.\d+)?)/);
    if (nv) nullValue = parseFloat(nv[1]!);
  }
  const tzMs = tzHours * HOUR_MS;

  const samples: Sample[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[4] !== "1") continue;
    const level = parseFloat(f[2]!);
    if (!Number.isFinite(level) || Math.abs(level - nullValue) < 1e-3) continue;
    const t = Date.parse(`${f[0]!.replaceAll("/", "-")}T${f[1]}Z`);
    if (!Number.isFinite(t)) continue;
    samples.push({ time: new Date(t - tzMs), level });
  }
  return samples;
}

/** Bin samples to mean level per UTC hour, sorted ascending. */
function binHourly(samples: Sample[]): Sample[] {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const key = Math.floor(s.time.getTime() / HOUR_MS);
    const e = buckets.get(key);
    if (e) {
      e.sum += s.level;
      e.n += 1;
    } else {
      buckets.set(key, { sum: s.level, n: 1 });
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, { sum, n }]) => ({
      time: new Date(key * HOUR_MS),
      level: sum / n,
    }));
}

/**
 * Derive tidal datums directly from observed water-level samples (NOAA CO-OPS
 * "first reduction", Computational Techniques for Tidal Datums Handbook §3.1).
 *
 * Bins to hourly heights, takes the most recent ≤18.6-year window, and computes
 * mean datums in the gauge's native frame with real MSL = mean of hourly heights.
 * No control-station correction (acceptable: short-record bias is cm-level per
 * Swanson 1974, vs the 0.3–0.5 m datum errors this replaces). HAT/LAT returned
 * here are observed extremes and should be discarded in favor of harmonic values.
 *
 * Returns null when the windowed record is too short/sparse to be meaningful.
 */
export function computeDatumsFromObservations(
  samples: Sample[],
): TidalDatumsResult | null {
  if (samples.length === 0) return null;

  const hourlyAll = binHourly(samples);
  const end = hourlyAll[hourlyAll.length - 1]!.time;
  const { start } = resolveEpoch({ end });
  const hourly = hourlyAll.filter((s) => s.time >= start);

  const spanDays = (end.getTime() - hourly[0]!.time.getTime()) / DAY_MS;
  if (spanDays < MIN_DATUM_DAYS || hourly.length < MIN_HOURLY_POINTS)
    return null;

  const observedMSL = mean(hourly.map((s) => s.level));
  const datums = computeDatumsFromExtremes(hourly, observedMSL);
  if (!Number.isFinite(datums["MHW"]) || !Number.isFinite(datums["MLW"]))
    return null;

  return { start: hourly[0]!.time, end, datums };
}

export function toFixed(num: number, digits: number) {
  if (typeof num !== "number") return num;

  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN;
}

/** Loop-based min/max — avoids the call-stack overflow of Math.min/max(...arr) on large arrays. */
export function max(arr: number[]): number {
  let m = -Infinity;
  for (const v of arr) if (v > m) m = v;
  return m;
}

export function min(arr: number[]): number {
  let m = Infinity;
  for (const v of arr) if (v < m) m = v;
  return m;
}
