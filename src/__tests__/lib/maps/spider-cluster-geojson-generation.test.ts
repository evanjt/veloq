/**
 * Tests for buildSpiderGeoJSON - pure GeoJSON generator for cluster fan-out.
 * No React / MapLibre / native dependencies, so we test the math directly.
 */

import { buildSpiderGeoJSON } from '@/features/maps/lib/buildSpiderGeoJSON';

function leaf(id: string): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { activityId: id, foo: 'bar' },
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('buildSpiderGeoJSON', () => {
  it('returns empty FeatureCollections when leaves is empty', () => {
    const result = buildSpiderGeoJSON({ center: [10, 45], leaves: [] }, 14);
    expect(result.points.features).toEqual([]);
    expect(result.lines.features).toEqual([]);
    expect(result.points.type).toBe('FeatureCollection');
    expect(result.lines.type).toBe('FeatureCollection');
  });

  it('produces one point and one line per leaf', () => {
    const leaves = [leaf('a'), leaf('b'), leaf('c')];
    const result = buildSpiderGeoJSON({ center: [10, 45], leaves }, 14);
    expect(result.points.features).toHaveLength(3);
    expect(result.lines.features).toHaveLength(3);
  });

  it('preserves leaf properties and adds isSpider: true', () => {
    const leaves = [leaf('a')];
    const result = buildSpiderGeoJSON({ center: [10, 45], leaves }, 14);
    expect(result.points.features[0].properties).toEqual({
      activityId: 'a',
      foo: 'bar',
      isSpider: true,
    });
  });

  it('each line goes from center to the corresponding spider point', () => {
    const leaves = [leaf('a'), leaf('b')];
    const center: [number, number] = [10, 45];
    const result = buildSpiderGeoJSON({ center, leaves }, 14);

    result.lines.features.forEach((line, i) => {
      expect(line.geometry.type).toBe('LineString');
      const coords = (line.geometry as GeoJSON.LineString).coordinates;
      expect(coords).toHaveLength(2);
      expect(coords[0]).toEqual(center);
      // Second point should match the spider point at same index
      expect(coords[1]).toEqual((result.points.features[i].geometry as GeoJSON.Point).coordinates);
    });
  });

  it('places points approximately on a circle around the center', () => {
    const leaves = Array.from({ length: 4 }, (_, i) => leaf(String(i)));
    const center: [number, number] = [0, 0]; // equator - no lngScale distortion
    const result = buildSpiderGeoJSON({ center, leaves }, 14);

    const coords = result.points.features.map((f) => (f.geometry as GeoJSON.Point).coordinates);
    // All points should be roughly equidistant from center
    const distances = coords.map(([lng, lat]) => Math.sqrt(lng * lng + lat * lat));
    const maxDist = Math.max(...distances);
    const minDist = Math.min(...distances);
    expect(Math.abs(maxDist - minDist)).toBeLessThan(1e-9);
  });

  it('higher zoom level yields a smaller radius in degrees', () => {
    const leaves = [leaf('a')];
    const center: [number, number] = [0, 0];
    const low = buildSpiderGeoJSON({ center, leaves }, 10);
    const high = buildSpiderGeoJSON({ center, leaves }, 16);

    const lowCoord = (low.points.features[0].geometry as GeoJSON.Point).coordinates;
    const highCoord = (high.points.features[0].geometry as GeoJSON.Point).coordinates;

    const lowDist = Math.hypot(lowCoord[0], lowCoord[1]);
    const highDist = Math.hypot(highCoord[0], highCoord[1]);
    expect(highDist).toBeLessThan(lowDist);
  });

  it('uses wider radius for larger cluster sizes', () => {
    // Radius is 40px for ≤6 leaves, 55px for 7-12, 70px for >12
    const center: [number, number] = [0, 0];
    const small = buildSpiderGeoJSON(
      { center, leaves: Array.from({ length: 4 }, (_, i) => leaf(String(i))) },
      14
    );
    const medium = buildSpiderGeoJSON(
      { center, leaves: Array.from({ length: 10 }, (_, i) => leaf(String(i))) },
      14
    );
    const large = buildSpiderGeoJSON(
      { center, leaves: Array.from({ length: 20 }, (_, i) => leaf(String(i))) },
      14
    );

    const distOf = (result: ReturnType<typeof buildSpiderGeoJSON>) => {
      const c = (result.points.features[0].geometry as GeoJSON.Point).coordinates;
      return Math.hypot(c[0], c[1]);
    };

    expect(distOf(medium)).toBeGreaterThan(distOf(small));
    expect(distOf(large)).toBeGreaterThan(distOf(medium));
  });

  it('places the first point at the top, north of the centre', () => {
    const leaves = [leaf('a')];
    const center: [number, number] = [0, 0];
    const result = buildSpiderGeoJSON({ center, leaves }, 14);
    const [lng, lat] = (result.points.features[0].geometry as GeoJSON.Point).coordinates;
    expect(lng).toBeCloseTo(0, 6);
    expect(lat).toBeGreaterThan(0);
  });

  describe('on screen at 46.5 degrees north', () => {
    // Web Mercator at the GL JS convention: the world is 512 * 2^zoom px wide.
    const project = ([lng, lat]: number[], zoom: number): [number, number] => {
      const world = 512 * Math.pow(2, zoom);
      const phi = (lat * Math.PI) / 180;
      return [
        ((lng + 180) / 360) * world,
        (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) * 0.5 * world,
      ];
    };

    it.each([
      [4, 40],
      [10, 55],
      [13, 70],
    ])('draws %i leaves %i px from the centre at every angle', (count, radiusPx) => {
      const zoom = 15;
      const center: [number, number] = [6.6, 46.5];
      const leaves = Array.from({ length: count }, (_, i) => leaf(String(i)));
      const result = buildSpiderGeoJSON({ center, leaves }, zoom);
      const [cx, cy] = project(center, zoom);

      for (const feature of result.points.features) {
        const [x, y] = project((feature.geometry as GeoJSON.Point).coordinates, zoom);
        expect(Math.hypot(x - cx, y - cy)).toBeGreaterThanOrEqual(radiusPx - 1);
        expect(Math.hypot(x - cx, y - cy)).toBeLessThanOrEqual(radiusPx + 1);
      }
    });

    it('puts the first leaf straight above the centre on screen', () => {
      const zoom = 15;
      const center: [number, number] = [6.6, 46.5];
      const result = buildSpiderGeoJSON({ center, leaves: [leaf('a'), leaf('b')] }, zoom);
      const [cx, cy] = project(center, zoom);
      const [x, y] = project(
        (result.points.features[0].geometry as GeoJSON.Point).coordinates,
        zoom
      );

      expect(x).toBeCloseTo(cx, 3);
      expect(y).toBeLessThan(cy);
    });
  });
});
