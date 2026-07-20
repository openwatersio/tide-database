# Chart datums per country

Predicted heights only line up with a national tide service when both use the
same vertical **chart datum**. Each country charts to its own datum, so the
tide database records a `chart_datum` per station and references its predictions
to it.

## Authoritative source

The per-country mapping follows the IHO Resolution (adopt **Lowest Astronomical
Tide (LAT)**, _or a datum as closely equivalent as is practical_, as chart
datum) and the IHO TWCWG **"List of Vertical Datums used by IHO Member States to
describe Chart Datum"** (2021):
<https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_Vertical_Datums_v1.0.pdf>

Most maritime nations use LAT (or a close equivalent); the notable exceptions
are the low-water-datum countries and the non-tidal Baltic.

| Country / region                      | Chart datum                             | Notes                                                                                  |
| ------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| United States (+ Pacific territories) | **MLLW** (Mean Lower Low Water)         | US low-water convention                                                                |
| Canada                                | **LLWLT** (Lower Low Water, Large Tide) | mean of the annual lowest low waters                                                   |
| Japan                                 | **NLLW** (Nearly Lowest Low Water)      | ≈ Indian Spring Low Water                                                              |
| South Korea                           | **ALLW** (Approximate Lowest Low Water) | ≈ Indian Spring Low Water                                                              |
| China                                 | **TLT** (Theoretical Lowest Tide)       | theoretical depth datum                                                                |
| Brazil, Italy, Chile                  | **MLWS** (Mean Low Water Springs)       | per the IHO TWCWG list                                                                 |
| Sweden, Baltic basin                  | **MSL** (≈ BSCD2000)                    | non-tidal Baltic; see below                                                            |
| Everyone else                         | **LAT**                                 | IHO default (UK, France, Netherlands, Australia, Norway, Spain, India, New Zealand, …) |

## Datum definitions added

The standard reduction (`tools/datum.ts`) already produced HAT/MHHW/MHW/MSL/MTL/
MLW/MLLW/LAT. This adds the datums the country map needs:

- **MHWS / MLWS** — Mean High/Low Water Springs, the Admiralty approximation
  `MSL ± (H_M2 + H_S2)`. Computed for every station.
- **NLLW / ALLW** — Indian Spring Low Water, `MSL − (H_M2 + H_S2 + H_K1 + H_O1)`.
  The same value under both national labels; kept only for Japan / South Korea.
- **LLWLT** — the mean of the annual lowest low waters over a full nodal cycle;
  kept only for Canada.
- **TLT** — China's theoretical lowest tide, the astronomical minimum of the
  Vladimirsky 13-constituent subset over a nodal cycle; kept only for China.

The extreme / amplitude-derived datums (HAT, LAT, LLWLT, NLLW, ALLW, TLT, MHWS,
MLWS) come from the harmonic prediction over a full 18.6-year nodal cycle and
are shifted into the observed gauge frame; the mean datums stay observed.
Country-specific datums are pruned from stations that don't use them
(`pruneDatums`), so a UK station never carries a stray TLT.

## Baltic split

The Baltic Sea is effectively non-tidal, so its riparian states chart to a
mean-sea-level datum (BSCD2000) rather than a low-water datum. Germany in
particular splits: **North Sea coast → LAT (Seekartennull)**, **Baltic coast →
MSL**. Administrative region can't separate them (Schleswig-Holstein touches
both seas) and neither can a longitude line (the lower Elbe reaches inland past
the longitude of the Baltic fjords). `tools/sea-regions.ts` classifies stations
with a point-in-polygon test against a coarse IHO S-23 Baltic Sea outline;
Baltic stations use MSL.

## Regenerating the data

The station JSONs are generated. After changing datum logic, regenerate them in
CI (the full GESLA-4 dataset is required and is not committed):

```sh
FORCE_DATUMS=1 node tools/import-ticon.ts
```

Datum-ordering QA (`tools/evaluate-quality.ts`) keeps the strict monotonic gate
for the standard datums and validates the new datums with bounded/relational
warnings only — the low-water cluster (LAT / ISLW / LLWLT / TLT / MLWS) has no
station-independent total order (the ISLW-family datums fall below LAT at ~3% of
stations by design).
