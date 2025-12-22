declare module '@mapbox/polyline' {
  /**
   * Decodes an encoded polyline string into an array of [lat, lng] tuples.
   */
  function decode(encoded: string, precision?: number): [number, number][];

  /**
   * Encodes an array of [lat, lng] tuples into a polyline string.
   */
  function encode(coordinates: [number, number][], precision?: number): string;

  /**
   * Decodes a polyline string into a GeoJSON LineString feature.
   */
  function toGeoJSON(encoded: string, precision?: number): GeoJSON.Feature<GeoJSON.LineString>;

  /**
   * Encodes a GeoJSON LineString feature into a polyline string.
   */
  function fromGeoJSON(
    geojson: GeoJSON.Feature<GeoJSON.LineString> | GeoJSON.LineString,
    precision?: number
  ): string;

  export { decode, encode, toGeoJSON, fromGeoJSON };
  export default { decode, encode, toGeoJSON, fromGeoJSON };
}
