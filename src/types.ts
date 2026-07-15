export interface HarmonicConstituent {
  name: string;
  description?: string;
  amplitude: number;
  phase: number;
  speed?: number;
}

export interface Constituent {
  name: string;
  description: string | null;
  speed: number;
}

export interface StationData {
  // Basic station information
  name: string;
  continent: string;
  country: string;
  region?: string;
  timezone: string;
  disclaimers: string;
  type: "reference" | "subordinate";
  latitude: number;
  longitude: number;

  // Data source information
  source: {
    name: string;
    id: string;
    published_harmonics: boolean;
    url: string;
  };

  // License information
  license: {
    type: string;
    commercial_use: boolean;
    url: string;
    notes?: string;
  };

  // Harmonic constituents (empty array for subordinate stations)
  harmonic_constituents: HarmonicConstituent[];

  // Subordinate station offsets (empty object for reference stations)
  offsets?: {
    reference: string;
    height: { high: number; low: number; type: "ratio" | "fixed" };
    time: { high: number; low: number };
  };

  datums: Record<string, number>;

  // How datums were derived: "observed" (from GESLA water-level measurements)
  // or "harmonic" (synthesized from harmonic constituents).
  datums_source?: "observed" | "harmonic";

  // The chart datum key used as the vertical reference (e.g., "MLLW", "LAT")
  chart_datum: string;

  // Epoch - the time period over which the harmonic constituents were computed
  epoch?: {
    start: string; // Date in YYYY-MM-DD format
    end: string; // Date in YYYY-MM-DD format
  };
}

export interface Station extends StationData {
  id: string;
}

// The light fields, bundled eagerly for all stations (~1.5 MB serialized;
// ~15 MB as live objects on the heap). Everything the search/geo/list paths
// need. The prediction data (harmonic_constituents, datums, epoch) is loaded
// per station from the pack — see station-data.ts.
export type StationMetaKey =
  | "name"
  | "latitude"
  | "longitude"
  | "region"
  | "country"
  | "continent"
  | "timezone"
  | "type"
  | "disclaimers"
  | "chart_datum"
  | "datums_source"
  | "source"
  | "license"
  | "offsets";

export type StationMeta = { id: string } & Pick<StationData, StationMetaKey>;

// The lazily-loaded prediction data, resolved per station from the data source
// (an off-heap pack file on Node, bundled JSON strings in the browser).
export interface PredictionData {
  harmonic_constituents: HarmonicConstituent[];
  datums: Record<string, number>;
  epoch?: StationData["epoch"];
}
