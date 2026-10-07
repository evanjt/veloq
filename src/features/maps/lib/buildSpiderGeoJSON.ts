/**
 * buildSpiderGeoJSON - pure GeoJSON generator for cluster spider fan-out.
 *
 * When a MapLibre cluster cannot expand further at max zoom, or a tap lands on
 * start points stacked on one another, we render the underlying points as a
 * spider/fan pattern around the centre with connecting legs. This function
 * takes a spider state (center + leaves) and the current map zoom, and returns
 * the point and line FeatureCollections needed to render both.
 */

/** Structural input required by buildSpiderGeoJSON. */
interface SpiderLayoutInput {
  center: [number, number]; // [lng, lat] cluster center
  leaves: GeoJSON.Feature[]; // individual activity features from the cluster
}

/**
 * Generate spider layout GeoJSON for cluster fan-out at max zoom.
 * Places N points on a circle around the cluster center, with lines connecting
 * each point back to the center. Uses screen-space radius converted to map
 * coordinates based on zoom level.
 */
export function buildSpiderGeoJSON(
  spider: SpiderLayoutInput,
  zoom: number
): { points: GeoJSON.FeatureCollection; lines: GeoJSON.FeatureCollection } {
  const { center, leaves } = spider;
  const n = leaves.length;

  // Screen radius to degrees of longitude. The map is MapLibre GL JS, whose
  // world is 512 * 2^zoom px wide, so a degree of longitude is that over 360.
  const pixelsPerDegree = (512 * Math.pow(2, zoom)) / 360;
  // In Web Mercator a degree of latitude spans 1/cos(lat) times a degree of
  // longitude on screen, so the latitude offset shrinks by cos(lat) to keep the
  // fan round at the radius asked for.
  const latScale = Math.cos((center[1] * Math.PI) / 180);
  const radiusPx = n <= 6 ? 40 : n <= 12 ? 55 : 70;
  const radiusDeg = radiusPx / pixelsPerDegree;

  const pointFeatures: GeoJSON.Feature[] = [];
  const lineFeatures: GeoJSON.Feature[] = [];

  for (let i = 0; i < n; i++) {
    // From north, clockwise. Latitude grows upwards on screen.
    const angle = (2 * Math.PI * i) / n + Math.PI / 2;
    const dx = -radiusDeg * Math.cos(angle);
    const dy = radiusDeg * Math.sin(angle) * latScale;
    const spiderCoord: [number, number] = [center[0] + dx, center[1] + dy];

    const leaf = leaves[i];
    pointFeatures.push({
      type: 'Feature',
      properties: {
        ...leaf.properties,
        isSpider: true,
      },
      geometry: {
        type: 'Point',
        coordinates: spiderCoord,
      },
    });

    lineFeatures.push({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [center, spiderCoord],
      },
    });
  }

  return {
    points: { type: 'FeatureCollection', features: pointFeatures },
    lines: { type: 'FeatureCollection', features: lineFeatures },
  };
}
