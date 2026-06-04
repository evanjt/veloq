/**
 * buildSpiderGeoJSON — pure GeoJSON generator for cluster spider fan-out.
 *
 * When a MapLibre cluster cannot expand further at max zoom, we render the
 * underlying points as a spider/fan pattern around the cluster center with
 * connecting legs. This function takes a spider state (center + leaves) and
 * the current map zoom, and returns the point and line FeatureCollections
 * needed to render both.
 *
 * Extracted from RegionalMapView.tsx — pure refactor, no behaviour change.
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

  // Convert ~40px screen radius to map degrees at current zoom
  // At zoom Z, 1 degree of longitude ≈ 256 * 2^Z / 360 pixels
  const pixelsPerDegree = (256 * Math.pow(2, zoom)) / 360;
  // Adjust for latitude (longitude degrees are narrower near poles)
  const latRadians = (center[1] * Math.PI) / 180;
  const lngScale = 1 / Math.cos(latRadians);
  const radiusPx = n <= 6 ? 40 : n <= 12 ? 55 : 70;
  const radiusDeg = radiusPx / pixelsPerDegree;

  const pointFeatures: GeoJSON.Feature[] = [];
  const lineFeatures: GeoJSON.Feature[] = [];

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at top
    const dx = radiusDeg * Math.cos(angle) * lngScale;
    const dy = radiusDeg * Math.sin(angle);
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
