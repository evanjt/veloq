/**
 * Contract tests for the snapshot render script generator.
 *
 * Scenario: the same generator now produces two render modes - the 3D terrain
 * drape and a flat top-down basemap for feed cards without interesting terrain.
 * Expected behaviour: flat scripts contain no terrain/sky/hillshade injection,
 * carry pitch 0, and 3D output is unchanged by the flat flag's existence.
 */

import {
  buildRenderSnapshotScript,
  SNAPSHOT_JPEG_QUALITY,
  QUALITY_CACHE_VERSION,
} from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
import { TERRAIN_CACHE_VERSION } from '@/features/maps/lib/storage/terrainPreviewCache';
import type { SnapshotRequest } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

function makeRequest(overrides: Partial<SnapshotRequest> = {}): SnapshotRequest {
  return {
    activityId: 'act-1',
    coordinates: [
      [7.0, 46.0],
      [7.1, 46.1],
    ],
    camera: { center: [7.05, 46.05], zoom: 12, bearing: 30, pitch: 58 },
    mapStyle: 'light',
    routeColor: '#14B8A6',
    ...overrides,
  };
}

describe('buildRenderSnapshotScript', () => {
  it('injects terrain, sky, and hillshade for 3D requests', () => {
    const script = buildRenderSnapshotScript(makeRequest(), 0, 1);
    expect(script).toContain("styleObj.sources['terrain'] = terrainSource");
    expect(script).toContain('styleObj.sky = skyConfig');
    expect(script).toContain("id: 'hillshading'");
    expect(script).toContain('var isFlat = false');
  });

  it('marks flat requests so terrain injection is skipped at runtime', () => {
    const script = buildRenderSnapshotScript(makeRequest({ flat: true }), 0, 1);
    expect(script).toContain('var isFlat = true');
    // Terrain injection is behind the isFlat guard
    expect(script).toContain('if (!isFlat) {');
    expect(script).toContain('if (!isFlat && !isSatellite) {');
  });

  it('applies the request camera verbatim, including pitch 0 for flat', () => {
    const flatCamera = {
      center: [7.05, 46.05] as [number, number],
      zoom: 12,
      bearing: 0,
      pitch: 0,
    };
    const script = buildRenderSnapshotScript(makeRequest({ flat: true, camera: flatCamera }), 0, 1);
    expect(script).toContain(JSON.stringify(flatCamera));
  });

  it('tracks base mode so a flat/3D flip cannot reuse the fast path', () => {
    const script = buildRenderSnapshotScript(makeRequest(), 0, 1);
    expect(script).toContain("var baseMode = isFlat ? 'flat' : '3d'");
    expect(script).toContain('window._currentBaseMode === baseMode');
    expect(script).toContain('window._currentBaseMode = baseMode');
  });

  it('keeps gap detection exclusive to 3D renders', () => {
    const script = buildRenderSnapshotScript(makeRequest({ flat: true }), 0, 1);
    expect(script).toContain('if (ctx && !isFlat) {');
    expect(script).toContain('if (ctx && (!isFlat || isSatellite)) {');
  });

  it('always includes the route layers regardless of mode', () => {
    for (const flat of [true, false]) {
      const script = buildRenderSnapshotScript(makeRequest({ flat }), 0, 1);
      expect(script).toContain("id: 'route-line'");
      expect(script).toContain("id: 'route-outline'");
      expect(script).toContain("id: 'start-end-fill'");
    }
  });
});

/**
 * Scenario: a feed preview is a 1080x720 JPEG drawn once, shown at about a
 * third of a screen height under a route line, and never zoomed. It was
 * encoded at 0.95, which is the setting for an image that will be re-encoded,
 * and cost a measured 240 KB each on a real device.
 * Expected behaviour: the encode reads a named constant rather than a literal,
 * and that constant stays in the band a thumbnail wants. A change to it has to
 * move `TERRAIN_CACHE_VERSION` too, or every preview already on a device keeps
 * being served at the old setting for the life of the install.
 */
describe('the snapshot encode', () => {
  it('encodes through the shared constant, not a literal in the script', () => {
    const script = buildRenderSnapshotScript(makeRequest(), 0, 1);

    expect(script).toContain(`canvas.toDataURL('image/jpeg', ${SNAPSHOT_JPEG_QUALITY})`);
  });

  it('keeps the quality in the band a feed thumbnail wants', () => {
    // Below 0.7 the route line's edge starts to show against satellite; at
    // 0.95 the file is twice the size for a difference measured at 1.8% RMSE.
    expect(SNAPSHOT_JPEG_QUALITY).toBeGreaterThanOrEqual(0.7);
    expect(SNAPSHOT_JPEG_QUALITY).toBeLessThanOrEqual(0.85);
  });

  it('has a cache version recorded against the quality it was drawn at', () => {
    // The pair moves together. A device holds previews drawn at whatever the
    // quality was when they were made, and only a version bump redraws them.
    expect(TERRAIN_CACHE_VERSION).toBeGreaterThanOrEqual(QUALITY_CACHE_VERSION);
  });
});
