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
