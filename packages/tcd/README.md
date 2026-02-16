# Neaps Tide Database - TCD (XTide Harmonics File)

This package generates an [XTide](https://flaterco.com/xtide/)-compatible TCD (Tide Constituent Database) binary file of the Neaps Tide Database. The TCD file can be used with XTide and any software that reads the [libtcd](https://flaterco.com/xtide/libtcd.html) format.

The TCD file includes all stations in the tide database, and all tidal constituents present in the station data, resolved through the constituent list from [@neaps/tide-predictor](https://github.com/openwatersio/neaps/tree/main/packages/tide-predictor#readme).

## Usage

Download the latest `neaps-YYYYMMDD.tcd` from [GitHub Releases](https://github.com/openwatersio/tide-database/releases) and point XTide at it:

```sh
export HFILE_PATH=/path/to/neaps-20260215.tcd
```

Launch the XTide graphical interface:

```sh
xtide
```

### Command-line usage

List all stations:

```sh
tide -m l
```

Search for stations by name (case-insensitive prefix match):

```sh
tide -m l | grep -i boston
```

Get tide predictions for a station:

```sh
tide -l "BOSTON, MA, United States"
```

Get predictions for a specific date range in CSV format:

```sh
tide -l "BOSTON, MA, United States" -b "2026-01-01 00:00" -e "2026-01-08 00:00" -f c -u m
```

## Contributing

Build the TCD file with:

```shell
npm run build
```

This runs [./build.ts](./build.ts) and produces `dist/harmonics.tcd`.

### Testing

The test suite compares XTide predictions from the built TCD against direct harmonic calculations from `@neaps/tide-predictor`, validating that high/low tide times match within 5 minutes (mean) and heights within 5 cm (mean) for a set of representative stations.

```shell
npm test
```

## References

- [XTide](https://flaterco.com/xtide/)
- [libtcd documentation](https://flaterco.com/xtide/libtcd.html)
- [TCD file format specification](https://flaterco.com/xtide/tcd.html)
- [@neaps/tide-predictor](https://github.com/openwatersio/neaps/tree/main/packages/tide-predictor)
