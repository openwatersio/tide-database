/**
 * Sea-basin classification for tide stations.
 *
 * The only basin we need to distinguish for chart-datum purposes is the Baltic
 * Sea: its riparian states reference charts to a mean-sea-level datum
 * (BSCD2000) rather than a low-water datum, because the Baltic is effectively
 * non-tidal. This lets us split Germany's North Sea coast (Seekartennull ≈ LAT)
 * from its Baltic coast (MSL), which administrative region can't do — the state
 * of Schleswig-Holstein straddles both seas — and a longitude line can't do
 * either, since the lower Elbe (North Sea drainage) reaches inland past the
 * longitude of the Baltic fjords.
 *
 * The polygon is a coarse hand-traced outline of the IHO "Limits of Oceans and
 * Seas" (S-23) Baltic Sea — the Baltic proper, the Gulfs of Bothnia, Finland
 * and Riga, and the Belts/Øresund/Kattegat entrance — with the western edge
 * drawn down the east coast of Jutland so the North Sea and Skagerrak are
 * excluded. It is intentionally generous offshore; precision only matters along
 * the German/Danish coast, which is validated in the tests.
 */

/** [longitude, latitude] vertices, tracing the Baltic Sea outline. */
export const BALTIC_POLYGON: readonly (readonly [number, number])[] = [
  [9.4, 54.4], // Kiel Bight / Flensburg approaches (German Baltic SW)
  [11.0, 53.9], // Mecklenburg Bight (Wismar/Warnemünde offshore)
  [14.5, 53.85], // Pomerania (Szczecin / Świnoujście)
  [19.7, 54.2], // Gdańsk Bay
  [21.2, 55.4], // Lithuania (Klaipėda)
  [24.6, 56.2], // Latvia / Gulf of Riga entrance
  [28.7, 59.3], // Gulf of Finland east (Narva)
  [30.7, 59.9], // St Petersburg
  [25.0, 60.3], // Helsinki
  [21.3, 63.1], // Gulf of Bothnia (Vaasa)
  [24.8, 66.0], // head of the Gulf of Bothnia (Kemi)
  [17.0, 62.5], // Swedish Bothnian coast (Sundsvall)
  [17.6, 59.4], // Stockholm archipelago
  [16.7, 56.4], // Öland / Kalmar
  [14.0, 55.2], // Skåne SE (Ystad)
  [12.5, 56.2], // Øresund (Malmö / Helsingborg)
  [12.9, 57.8], // Kattegat, Swedish west coast (Gothenburg)
  [10.6, 57.6], // Kattegat north (below Skagen, so the Skagerrak stays out)
  [10.7, 56.0], // Danish Great Belt
  [9.9, 55.4], // Danish Little Belt
  [9.4, 54.9], // Flensburg Fjord (close back to start)
];

/**
 * Ray-casting point-in-polygon test. `polygon` is a list of [lon, lat] vertices
 * (open ring; the closing edge is implied). Longitude/latitude are treated as
 * planar x/y, which is fine at this scale for a coarse basin mask.
 */
export function pointInPolygon(
  lon: number,
  lat: number,
  polygon: readonly (readonly [number, number])[] = BALTIC_POLYGON,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when the coordinate falls within the Baltic Sea basin. */
export function isBaltic(lat: number, lon: number): boolean {
  return pointInPolygon(lon, lat, BALTIC_POLYGON);
}
