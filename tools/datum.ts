import tidePredictor, {
  type TidePredictionOptions,
  type HarmonicConstituent,
} from "@neaps/tide-predictor";

export interface EpochSpec {
  start?: Date;
  end?: Date;
}

export type Datums = Record<string, number>;

export interface TidalDatumsResult {
  epochStart: Date;
  epochEnd: Date;
  lengthYears: number;

  /** seconds between samples in the synthetic series */
  timeFidelity: number;
  /** tidal-day length used (hours) */
  tidalDayHours: number;

  datums: Datums;
}

export interface DatumsOptions extends TidePredictionOptions {
  /**
   * Time step in hours for the synthetic series.
   * Converted to `timeFidelity` in seconds for neaps.
   * Default: 1 hour.
   */
  stepHours?: number;

  /**
   * Length of a "tidal day" in hours.
   * Typical: 24.8333 (24h 50m).
   * Default: 24.8333333.
   */
  tidalDayHours?: number;
}

const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;
const NINETEEN_YEARS = 19 * YEAR_MS;

/**
 * Resolve an EpochSpec to explicit start/end Dates.
 */
export function resolveEpoch({
  end = new Date(),
  start = new Date(end.getTime() - NINETEEN_YEARS),
}: EpochSpec): {
  start: Date;
  end: Date;
  lengthYears: number;
} {
  let lengthYears = (end.getTime() - start.getTime()) / YEAR_MS;
  if (lengthYears > 19) {
    start = new Date(end.getTime() - NINETEEN_YEARS);
    lengthYears = 19;
  }
  return { start, end, lengthYears };
}

/**
 * Core helper: given a regular timeline of {time, level}, compute datums
 */
function computeDatumsFromTimeline(
  times: Date[],
  heights: number[],
  tidalDayHours: number,
): Datums {
  if (!times.length || times.length !== heights.length) {
    throw new Error("times and heights must be non-empty and of equal length");
  }

  const allHighs: number[] = [];
  const allLows: number[] = [];
  const higherHighs: number[] = [];
  const lowerLows: number[] = [];

  const tidalDayMs = tidalDayHours * 60 * 60 * 1000;

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
    MHHW: toFixed(mean(higherHighs), 3),
    MHW: toFixed(mhw, 3),
    MSL: toFixed(mean(heights), 3),
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
  {
    stepHours = 1,
    tidalDayHours = 24.8333333,
    ...tidePredictorOptions
  }: DatumsOptions = {},
): TidalDatumsResult {
  const { start, end, lengthYears } = resolveEpoch(epochSpec);

  const timeFidelity = stepHours * 60 * 60;

  // Build predictor from @neaps/tide-predictor
  const predictor = tidePredictor(constituents, tidePredictorOptions);

  // Ask it for a synthetic timeline over the epoch
  const timeline = predictor.getExtremesPrediction({
    start,
    end,
    timeFidelity,
  });

  const times = timeline.map((pt) => pt.time);
  const heights = timeline.map((pt) => pt.level);

  return {
    epochStart: start,
    epochEnd: end,
    lengthYears,
    timeFidelity,
    tidalDayHours,
    datums: computeDatumsFromTimeline(times, heights, tidalDayHours),
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
