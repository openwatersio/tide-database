# TICON-4 Tide Station Data

[TICON-4](https://www.seanoe.org/data/00980/109129/) is a global dataset of tidal harmonic constituents derived from the **GESLA-4** (Global Extreme Sea Level Analysis v.4) sea-level gauge compilation. It provides tidal characteristics for  **4,264 tide stations** worldwide, with emphasis on global coverage outside the United States (which is covered by NOAA's tide database).

**Key Details:**
- **Source:** [TICON-4 @ SEANOE](https://www.seanoe.org/data/00980/109129/)
- **Manual:** [TICON Documentation](https://www.seanoe.org/data/00980/109129/data/122852.pdf)
- **License:** CC-BY-4.0 (Creative Commons Attribution 4.0)
- **Coverage:** Global tide stations with harmonic constituent analysis from GESLA-4 observations

Each station in this dataset contains harmonic constituents (amplitude and phase for tidal frequency components such as M2, K1, O1, etc.) extracted from historical sea-level records.

![](https://www.seanoe.org/data/00980/109129/illustration.jpg)

## Synthetic Tidal Datums

TICON-4 does not provide empirically derived tidal datums. Instead, this dataset includes **synthetic tidal datums** computed from 19-year harmonic predictions using the harmonic constituents, not from observed water level data. This approach generates theoretical datums that represent long-term average tidal characteristics without the influence of weather events, non-tidal water level changes, or observational gaps.

These datums should eventually be replaced with water-level-derived datums when available. See [#40](https://github.com/neaps/tide-database/issues/40).

## References

- [TICON-4 Dataset](https://www.seanoe.org/data/00980/109129/)
- [TICON Manual](https://www.seanoe.org/data/00980/109129/data/122852.pdf)
- [GESLA-4 Project](https://gesla787883612.wordpress.com)
