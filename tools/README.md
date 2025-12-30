# Tide database tools

### Update NOAA Stations

The command `update-noaa-stations` updates all NOAA station files in the data directory with the latest harmonic constituents from the NOAA API.

```shell
tools/update-noaa-stations.ts
```

### Hawaii

The command `hawaii-converter.js` converts DAT files from the (University of Hawaii's Sea Level Center)[http://uhslc.soest.hawaii.edu/data/?fd#uh109] to a format that is readable by Xtide's Harmgen. The first argument should be the data file, the second where you want the output to be.

```shell
node hawaii-converter.js input.dat output.txt
```
