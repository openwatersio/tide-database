# Neaps Tide Database

> A public database of tide harmonics

This database includes harmonic constituents for tide prediction from various sources around the world. These constants can be used with a tide harmonic calculator like [Neaps](https://github.com/neaps/neaps) to create astronomical tide predictions.

## Sources

- ✅ [**NOAA**](https://tidesandcurrents.noaa.gov): National Oceanic and Atmospheric Administration
  ~3379 stations, mostly in the United States and its territories. Updated monthly via [NOAA's API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).

- 🔜 [**TICON-4**](https://www.seanoe.org/data/00980/109129/): TIdal CONstants based on GESLA-4 sea-level records
  4,838 global stations - ([#16](https://github.com/neaps/tide-database/pull/16))

If you know of other public sources of harmonic constituents, please [open an issue](https://github.com/neaps/tide-database/issues/new) to discuss adding them.

## Usage

The database is currently only available as an NPM package, but may be available in other formats like [sqlite](https://github.com/neaps/tide-database/issues/18) and [xtide's tcd format](https://github.com/neaps/tide-database/issues/19) in the future.

### JavaScript / TypeScript

Install the package:

```sh
$ npm install @neaps/tide-database
```

The package exports an array of all tide stations in the database:

```typescript
import stations from '@neaps/tide-database';

// Stations is an array of all the files in `data/`
console.log('Total stations:', stations.length);
console.log(stations[0]);
```

## Data Format

Each tide station is defined in a single JSON file in the [`data/`](./data) directory that includes basic station information, like location and name, and harmonics or subordinate station offsets. The format is defined by the schema in [../schemas/station.schema.json](schemas/station.schema.json), which includes more detailed descriptions of each field. All data is validated against this schema automatically on each change.

## Station Types

Stations can either be _reference_ or _subordinate_, defined in the station's `type` field.

### Reference station

Reference stations have defined harmonic constituents. They should have an array of `harmonic_constituents`. These are usually stations that have a long selection of real water level observations.

### Subordinate station

Subordinate stations are locations that have very similar tides to a reference station. Usually these are geographically close to another reference station.

Subordinate stations have four kinds of offsets, two to correct for water level, and two for the time of high and low tide. They use an `offsets` object to define these items, along with the name of the reference station they are based on.

## Maintenance

A GitHub Action runs monthly on the 1st of each month to automatically update NOAA tide station data. The workflow:
- Fetches the latest station list and harmonic constituents from NOAA's API
- Updates existing station files with new data
- Adds any newly discovered reference stations
- Creates a pull request if changes are detected

You can also manually trigger the workflow from the Actions tab in GitHub.

To manually update NOAA stations:

```bash
$ tools/update-noaa-stations.ts
```

This will scan all existing NOAA station files, fetch any new stations from NOAA's API, and update harmonic constituents for all stations.

## Versioning

Releases of this database use [Semantic Versioning](https://semver.org/), with these added semantics:

* Major version changes indicate breaking changes to the data structure or APIs. However, as long as the version is "0.x", breaking changes may occur without a major version bump.
* Minor version changes indicate backward-compatible additions to the data structure or APIs, such as new fields.
* Patch version changes indicate updates to station data, and will always be the current date. For example, "0.1.20260101".
