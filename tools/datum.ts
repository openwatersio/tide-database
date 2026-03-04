import {
  createTidePredictor,
  type TidePredictionOptions,
  type HarmonicConstituent,
  type Extreme,
} from "@neaps/tide-predictor";

export interface EpochSpec {
  end?: Date;
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
 * Core helper: given a regular timeline of {time, level}, compute datums
 */
function computeDatumsFromExtremes(extremes: Extreme[]): Datums {
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
    HAT: toFixed(Math.max(...heights), 3),
    MHHW: toFixed(mean(higherHighs), 3),
    MHW: toFixed(mhw, 3),
    // MSL is the average of hourly heights over the epoch, which is zero or close to it
    // when synthesizing from constituents.
    MSL: 0,
    MTL: toFixed((mhw + mlw) / 2, 3),
    MLW: toFixed(mlw, 3),
    MLLW: toFixed(mean(lowerLows), 3),
    LAT: toFixed(Math.min(...heights), 3),
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

export function toFixed(num: number, digits: number) {
  if (typeof num !== "number") return num;

  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN;
}
