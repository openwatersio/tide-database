import { openSync, readSync } from "fs";
import { PMTiles, type Source, type RangeResponse } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Protobuf from "pbf";

/** Byte-range source for reading a local .pmtiles file. */
class FileSource implements Source {
  private fd: number;

  constructor(private path: string) {
    this.fd = openSync(path, "r");
  }

  getKey(): string {
    return this.path;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const buffer = Buffer.alloc(length);
    readSync(this.fd, buffer, 0, length, offset);
    return {
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + length,
      ) as ArrayBuffer,
    };
  }
}

export function openPMTiles(path: string): PMTiles {
  return new PMTiles(new FileSource(path));
}

/** Web Mercator tile coordinates containing the given location. */
export function lonLatToTile(lon: number, lat: number, zoom: number) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        n,
    ),
  };
}

export function decodeTile(data: ArrayBuffer): VectorTile {
  return new VectorTile(new Protobuf(new Uint8Array(data)));
}

/** All features in a tile's layer, decoded to GeoJSON-ish objects. */
export function getFeatures(tile: VectorTile, layerName = "stations") {
  const layer = tile.layers[layerName];
  if (!layer) return [];
  return Array.from({ length: layer.length }, (_, i) => layer.feature(i));
}
