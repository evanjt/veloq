/**
 * Contract tests for the snapshot render script generator.
 *
 * Scenario: the same generator now produces two render modes — the 3D terrain
 * drape and a flat top-down basemap for feed cards without interesting terrain.
 * Expected behaviour: flat scripts contain no terrain/sky/hillshade injection,
 * carry pitch 0, and 3D output is unchanged by the flat flag's existence.
 */

import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';
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
