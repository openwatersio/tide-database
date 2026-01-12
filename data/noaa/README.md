## NOAA Tide Station Data Overview

This database fetches tide station metadata from NOAA CO-OPS and converts it into a local, normalized dataset. It classifies stations by prediction method, stores harmonic constituents or prediction offsets as appropriate, and records available tidal datums for reference.

The goal is to mirror how NOAA operationally produces tide predictions, not just what data exists in their metadata.

### Reference stations

Reference stations use **harmonic constituents** to generate tide predictions. These stations:

- Have a full harmonic solution derived from long water-level records
- Support predictions in multiple datums (MLLW, MSL, MTL, etc., when available)
- Can produce both continuous predictions and high/low events

For these stations, the script downloads harmonic constituents and datum values directly from NOAA.

### Subordinate stations

Subordinate stations do not use harmonics for predictions. Instead, their tides are derived from a nearby reference station using **prediction offsets**.

For subordinate stations:

- High and low tide times are shifted by a fixed number of minutes
- Tide heights are adjusted using either additive or ratio-based offsets
- Predictions are based on extreme events only, with linear interpolation between them
- NOAA serves predictions **only in MLLW** and **only as high/low events**

Some subordinate stations still list harmonic constituents in NOAA metadata; these are retained for historical and analytical purposes but are not used operationally.

### Datums

NOAA’s predictions are produced by offsetting tidal predictions from MSL (mean sea level), so that the requested datum corresponds to zero.

- Reference stations can return predictions in any supported datums
- Subordinate stations return predictions in **MLLW only**, even if other datums are listed
