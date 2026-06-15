# TICON-4 Tide Station Data

[TICON-4](https://www.seanoe.org/data/00980/109129/) is a global dataset of tidal harmonic constituents derived from the **GESLA-4** (Global Extreme Sea Level Analysis v.4) sea-level gauge compilation. It provides tidal characteristics for  **4,264 tide stations** worldwide, with emphasis on global coverage outside the United States (which is covered by NOAA's tide database).

**Key Details:**
- **Source:** [TICON-4 @ SEANOE](https://www.seanoe.org/data/00980/109129/)
- **Manual:** [TICON Documentation](https://www.seanoe.org/data/00980/109129/data/122852.pdf)
- **License:** CC-BY-4.0 (Creative Commons Attribution 4.0)
- **Coverage:** Global tide stations with harmonic constituent analysis from GESLA-4 observations

Each station in this dataset contains harmonic constituents (amplitude and phase for tidal frequency components such as M2, K1, O1, etc.) extracted from historical sea-level records.

![](https://www.seanoe.org/data/00980/109129/illustration.jpg)

## Tidal Datums

TICON-4 does not publish tidal datums, so we derive them from the original GESLA-4 water-level measurements following the NOAA CO-OPS "first reduction" method ([Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf)):

- The water-level record is binned to hourly heights and reduced over the most recent ≤18.6-year nodal cycle.
- **MSL, MHHW, MHW, MTL, MLW, MLLW** are the mean datums computed directly from those observations, in the gauge's native frame with real MSL = mean of hourly heights.
- **HAT** and **LAT** are astronomical extremes, kept from a 19-year harmonic prediction ([IHO definition](https://iho.int/uploads/user/pubs/standards/m-3/M-3_e3.3.0_Repertory_Aug20_2020_FINAL.pdf)) rather than observed maxima/minima, since observed extremes include storm surge.

Each station records its provenance in `datums_source`: `observed` when derived from GESLA water levels, or `harmonic` when the record was too short or sparse to reduce, in which case all datums fall back to synthetic 19-year harmonic predictions.

Cross-checked against authoritative agency datums (NOAA CO-OPS, Canada CHS), the observed datums substantially reduce the vertical bias of the old synthetic approach — e.g. great-diurnal-range bias dropped from ~0.2 m to <0.03 m. See [#40](https://github.com/openwatersio/tide-database/issues/40) and [`tools/validate-datums.ts`](../../tools/validate-datums.ts).

## References

- [TICON-4 Dataset](https://www.seanoe.org/data/00980/109129/)
- [TICON Manual](https://www.seanoe.org/data/00980/109129/data/122852.pdf)
- [GESLA-4 Project](https://gesla787883612.wordpress.com)
