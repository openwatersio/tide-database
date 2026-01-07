import _constituents from './constituents.json' with { type: 'json' }

export interface HarmonicConstituent {
  name: string
  description?: string
  amplitude: number
  phase: number
  speed?: number
}

export interface Constituent {
  name: string
  description: string | null
  speed: number
}

export interface Station {
  // Basic station information
  id: string
  name: string
  continent: string
  country: string
  region?: string
  timezone: string
  disclaimers: string
  type: 'reference' | 'subordinate'
  latitude: number
  longitude: number

  // Data source information
  source: {
    name: string
    id: string
    published_harmonics: boolean
    url: string
  }

  // License information
  license: {
    type: string
    commercial_use: boolean
    url: string
    notes?: string
  }

  // Harmonic constituents (empty array for subordinate stations)
  harmonic_constituents: HarmonicConstituent[]

  // Subordinate station offsets (empty object for reference stations)
  offsets?: {
    reference: string
    height: { high: number; low: number; type: 'ratio' | 'fixed' }
    time: { high: number; low: number }
  }

  datums: Record<string, number>
}

export const constituents: Constituent[] = _constituents

export const stations: Station[] = Object.values(
  import.meta.glob('../data/**/*.json', { eager: true, import: 'default' })
)
