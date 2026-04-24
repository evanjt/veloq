/**
 * Tests for clusterZoom — pure logic that decides how to zoom into a cluster.
 * No React / MapLibre dependencies, so we test the math directly.
 */

import { computeLeafBounds, planClusterZoom, CLUSTER_ZOOM_CONSTANTS } from '@/lib/maps/clusterZoom';

function pointFeature(lng: number, lat: number, id: string): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { id },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

describe('computeLeafBounds', () => {
  it('returns null for empty feature list', () => {
    expect(computeLeafBounds([])).toBeNull();
  });

  it('returns null when no point features are present', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
    ];
    expect(computeLeafBounds(features)).toBeNull();
  });

  it('computes correct bounds for a single point', () => {
    const bounds = computeLeafBounds([pointFeature(10, 45, 'a')]);
    expect(bounds).toEqual({
      ne: [10, 45],
      sw: [10, 45],
      spanLng: 0,
      spanLat: 0,
    });
  });

  it('computes correct bounds for multiple points', () => {
    const features = [
      pointFeature(10, 45, 'a'),
      pointFeature(11, 46, 'b'),
      pointFeature(9, 44, 'c'),
    ];
    const bounds = computeLeafBounds(features);
    expect(bounds).toEqual({
      ne: [11, 46],
      sw: [9, 44],
      spanLng: 2,
      spanLat: 2,
    });
  });

  it('ignores non-finite coordinates', () => {
    const features = [
      pointFeature(10, 45, 'a'),
      pointFeature(NaN, Infinity, 'bad'),
      pointFeature(11, 46, 'b'),
    ];
    const bounds = computeLeafBounds(features);
    expect(bounds).toEqual({
      ne: [11, 46],
      sw: [10, 45],
      spanLng: 1,
      spanLat: 1,
    });
  });
});

describe('planClusterZoom', () => {
  const center: [number, number] = [10, 45];

  it('returns stacked plan when leaves are all at the same point', () => {
    const features = [
      pointFeature(10, 45, 'a'),
      pointFeature(10, 45, 'b'),
      pointFeature(10, 45, 'c'),
    ];
    const plan = planClusterZoom(features, center);
    expect(plan.kind).toBe('stacked');
    if (plan.kind === 'stacked') {
      expect(plan.center).toEqual(center);
      expect(plan.leafCount).toBe(3);
    }
  });

  it('returns stacked plan when leaves are within the stacked epsilon', () => {
    // Spread of 0.0001° in both axes is below STACKED_LEAF_SPAN_DEG (0.0002).
    const features = [pointFeature(10, 45, 'a'), pointFeature(10.0001, 45.0001, 'b')];
    const plan = planClusterZoom(features, center);
    expect(plan.kind).toBe('stacked');
  });

  it('returns fitBounds plan for spatially spread leaves', () => {
    const features = [
      pointFeature(10, 45, 'a'),
      pointFeature(10.5, 45.5, 'b'),
      pointFeature(9.8, 44.9, 'c'),
    ];
    const plan = planClusterZoom(features, center);
    expect(plan.kind).toBe('fitBounds');
    if (plan.kind === 'fitBounds') {
      expect(plan.bounds.ne).toEqual([10.5, 45.5]);
      expect(plan.bounds.sw).toEqual([9.8, 44.9]);
      expect(plan.leafCount).toBe(3);
    }
  });

  it('uses short duration for small clusters (< 20 leaves)', () => {
    const features = Array.from({ length: 5 }, (_, i) =>
      pointFeature(10 + i * 0.1, 45 + i * 0.1, `a${i}`)
    );
    const plan = planClusterZoom(features, center);
    expect(plan.kind).toBe('fitBounds');
    if (plan.kind === 'fitBounds') {
      expect(plan.durationMs).toBe(300);
    }
  });

  it('uses long duration for large clusters (≥ 20 leaves)', () => {
    const features = Array.from({ length: 25 }, (_, i) =>
      pointFeature(10 + i * 0.1, 45 + i * 0.1, `a${i}`)
    );
    const plan = planClusterZoom(features, center);
    expect(plan.kind).toBe('fitBounds');
    if (plan.kind === 'fitBounds') {
      expect(plan.durationMs).toBe(600);
    }
  });

  it('uses the boundary value (20 leaves) as large', () => {
    // Exactly 20 leaves should be treated as large (spec says < 20 is small).
    const features = Array.from({ length: 20 }, (_, i) =>
      pointFeature(10 + i * 0.1, 45 + i * 0.1, `a${i}`)
    );
    const plan = planClusterZoom(features, center);
    if (plan.kind === 'fitBounds') {
      expect(plan.durationMs).toBe(600);
    }
  });

  it('returns stacked plan when leaves list is empty', () => {
    const plan = planClusterZoom([], center);
    expect(plan.kind).toBe('stacked');
    if (plan.kind === 'stacked') {
      expect(plan.center).toEqual(center);
      expect(plan.leafCount).toBe(0);
    }
  });

  it('exposes the tuning constants so spec and impl stay aligned', () => {
    expect(CLUSTER_ZOOM_CONSTANTS.SMALL_CLUSTER_LEAF_COUNT).toBe(20);
    expect(CLUSTER_ZOOM_CONSTANTS.STACKED_LEAF_SPAN_DEG).toBeGreaterThan(0);
  });
});
