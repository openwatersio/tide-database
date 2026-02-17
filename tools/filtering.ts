import type { StationData } from "../src/index.ts";

/**
 * Shared utilities for station filtering and deduplication
 */

/**
 * Source quality priority for TICON stations (lower = better quality)
 *
 * When multiple stations exist at the same location, this priority determines
 * which source to keep. Higher priority sources are more reliable, more recent,
 * or more authoritative.
 */
export const SOURCE_PRIORITY: Record<string, number> = {
  // Tier 1: Highest priority - most reliable and current
  uhslc_fd: 1, // University of Hawaii Sea Level Center - Fast Delivery
  bodc: 2, // British Oceanographic Data Centre

  // Tier 2: High quality national/regional services
  meds: 4, // Canadian Marine Environmental Data Service
  refmar: 5, // French Reference Network
  bom: 6, // Australian Bureau of Meteorology
  jodc_jma: 7, // Japan Meteorological Agency
  smhi: 8, // Swedish Meteorological Institute
  nhs: 9, // Norwegian Hydrographic Service
  ieo: 10, // Spanish Oceanographic Institute

  // Tier 3: Regional services
  wsv: 20,
  rws: 21,
  rws_hist: 22,
  fmi: 23,
  dmi: 24,
  ispra: 25,
  noc: 26,
  eseas: 27,
  bfg: 28,
  icg: 29,

  // Tier 4: US regional sources
  usgs: 40,
  crms: 41,
  cdwr: 42,
  sfwmd: 43,
  nwfwmd: 44,
  ncdem: 45,
  hct: 46,
  cm: 47,

  // Tier 5: Lower priority - older versions or research quality
  uhslc_rq: 80, // Research Quality - older UHSLC version
  unam: 85,
  unam_hist: 86,
  jodc_pahb: 87,
  jodc_jcg: 88,
  jodc_giaj: 89,
  ttw: 90,
  mi_c: 91,
  mi_r: 92,
  cco: 93,
  da_idh: 94,
  da_mm: 95,
  gloss: 96,

  // Tier 6: Non-commercial GESLA sources (research use only per GESLA license)
  cmems: 97, // Copernicus Marine Environment Monitoring Service
  cv: 97, // City of Venice
  uz: 97, // University of Zagreb

  // Tier 7: Lowest priority - often duplicates
  da_sat: 99, // Satellite-derived, often duplicates NOAA
};

/** Default priority for unknown sources */
export const DEFAULT_PRIORITY = 50;

/** GESLA sources that restrict commercial/consultancy use */
export const NON_COMMERCIAL_SOURCES = ["cmems", "cv", "uz"];

/**
 * Extract the source suffix from a TICON source ID
 * Example: "abashiri-347-jpn-uhslc_fd" -> "uhslc_fd"
 */
export function getSourceSuffix(sourceId: string): string {
  const parts = sourceId.toString().split("-");
  return parts[parts.length - 1]!;
}

/**
 * Get the priority value for a source ID
 * Lower numbers = higher priority
 */
export function getSourcePriority(sourceId: string): number {
  const suffix = getSourceSuffix(sourceId);
  return SOURCE_PRIORITY[suffix] ?? DEFAULT_PRIORITY;
}

/**
 * Check if a station has quality control issues based on its disclaimers
 */
export function hasQualityIssues(disclaimers?: string): boolean {
  return disclaimers?.includes("quality control issues") ?? false;
}

/**
 * Compute observation years from an epoch object
 */
export function epochYears(epoch?: { start: string; end: string }): number {
  if (!epoch) return 0;
  const start = new Date(epoch.start);
  const end = new Date(epoch.end);
  return (end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Compare two stations for priority, considering source quality, data quality,
 * and observation period length.
 *
 * Returns negative if station1 has higher priority, positive if station2 has higher priority
 *
 * Priority rules (in order):
 * 1. Stations without quality issues are preferred over those with issues
 * 2. Prefer longer observation period (more years)
 * 3. Among stations with same record length, prefer higher priority source
 * 4. Tie-breaker: alphabetically by source ID
 */
export function compareStationPriority(
  station1: StationData,
  station2: StationData,
): number {
  // Rule 1: Quality issues - stations without issues have higher priority
  const issues1 = hasQualityIssues(station1.disclaimers);
  const issues2 = hasQualityIssues(station2.disclaimers);

  if (issues1 !== issues2) {
    return issues1 ? 1 : -1; // Station without issues wins
  }

  // Rule 2: Longer observation period wins
  const years1 = epochYears(station1.epoch);
  const years2 = epochYears(station2.epoch);

  if (years1 !== years2) {
    return years2 - years1; // More years wins (reverse order)
  }

  // Rule 3: Source priority
  const priority1 = getSourcePriority(station1.source.id);
  const priority2 = getSourcePriority(station2.source.id);

  if (priority1 !== priority2) {
    return priority1 - priority2; // Lower priority number wins
  }

  // Rule 4: Alphabetical tie-breaker
  return station1.source.id.localeCompare(station2.source.id);
}

/**
 * Calculate distance between two points using Haversine formula
 * @returns Distance in kilometers
 */
export function distance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Minimum distance between TICON stations and NOAA stations (in km) */
export const MIN_DISTANCE_TO_NOAA = 0.1; // 100 meters

/** Minimum distance between TICON stations (in km) */
export const MIN_DISTANCE_TICON = 0.05; // 50 meters
