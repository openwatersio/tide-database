# Neaps Tide Database - TCD (XTide Harmonics File)

This package generates a TCD (Tide Constituent Database) binary file of the Neaps Tide Database. The TCD file can be used with [XTide](https://flaterco.com/xtide/), [OpenCPN](https://opencpn.org), and any software that reads the [libtcd](https://flaterco.com/xtide/libtcd.html) format.

The TCD file includes all stations in the tide database, and all tidal constituents present in the station data, resolved through the constituent list from [@neaps/tide-predictor](https://github.com/openwatersio/neaps/tree/main/packages/tide-predictor#readme).

## Usage

Download the latest `neaps-YYYYMMDD.tcd` from [GitHub Releases](https://github.com/openwatersio/tide-database/releases).

### OpenCPN

Open the OpenCPN options, navigate to the "Charts" tab, and add the TCD file as a "Tides & Currents" data source. See the [OpenCPN manual](https://opencpn.org/wiki/dokuwiki/doku.php?id=opencpn%3Amanual\_basic%3Aset\_options%3Acharts%3Atides-currents) for more details.

![screenshot of tide stations in OpenCPN](https://github.com/user-attachments/assets/6e57f4fd-0dad-4aae-b1db-fe638915c225)

### XTide

To use the TCD file with XTide, set the `HFILE_PATH` environment variable to point to the downloaded TCD file:

```sh
export HFILE_PATH=/path/to/neaps-*.tcd
```

Launch the XTide graphical interface:

```sh
xtide
```

#### Command-line usage

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

* Build the TCD file with: `npm run build`
* Run tests with: `npm test`

## References

- [XTide](https://flaterco.com/xtide/)
- [libtcd documentation](https://flaterco.com/xtide/libtcd.html)
- [TCD file format specification](https://flaterco.com/xtide/tcd.html)
- [@neaps/tide-predictor](https://github.com/openwatersio/neaps/tree/main/packages/tide-predictor)
