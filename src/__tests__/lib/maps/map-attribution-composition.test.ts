/**
 * Tests for computeAttribution - pure attribution-text computation.
 * Imports from `@/features/maps/components/mapStyles`, which pulls only JSON and
 * pure geometry helpers (no MapLibre). No mocking needed.
 */

import { computeAttribution } from '@/features/maps/lib/computeAttribution';
import type { LngLatBounds } from '@/features/maps/lib/coordinates';

describe('computeAttribution', () => {
  it('returns the light-style attribution without 3D', () => {
    const result = computeAttribution({
      style: 'light',
      is3D: false,
      center: null,
      zoom: 0,
    });
    expect(result).toContain('OpenFreeMap');
    expect(result).not.toContain('Terrain');
  });

  it('returns the dark-style attribution without 3D', () => {
    const result = computeAttribution({
      style: 'dark',
      is3D: false,
      center: null,
      zoom: 0,
    });
    expect(result).toContain('OpenFreeMap');
    expect(result).not.toContain('Terrain');
  });

  it('appends terrain attribution when is3D is true on non-satellite style', () => {
    const result = computeAttribution({
      style: 'light',
      is3D: true,
      center: null,
      zoom: 0,
    });
    expect(result).toContain('OpenFreeMap');
    expect(result).toBe('© OpenFreeMap · © OpenMapTiles · © OpenStreetMap · Mapzen');
  });

  it('returns the fallback satellite attribution when center is null', () => {
    const result = computeAttribution({
      style: 'satellite',
      is3D: false,
      center: null,
      zoom: 0,
    });
    // When no center, MAP_ATTRIBUTIONS.satellite default is used
    expect(result).toContain('EOX');
  });

  it('returns dynamic satellite attribution when center is provided', () => {
    // Center over the ocean (no regional source) at low zoom → just EOX
    const result = computeAttribution({
      style: 'satellite',
      is3D: false,
      center: [-30, 0], // mid-atlantic
      zoom: 5,
    });
    expect(result).toContain('EOX');
  });

  it('appends terrain attribution when is3D is true on satellite with center', () => {
    const result = computeAttribution({
      style: 'satellite',
      is3D: true,
      center: [-30, 0],
      zoom: 5,
    });
    expect(result).toBe('Sentinel-2 cloudless by EOX · Mapzen');
  });

  it('names each source across the Geneva border in 3D by its short credit', () => {
    // The west edge draws IGN France, the north-east swisstopo, and the
    // south-east corner over the Aosta valley falls onto the global base.
    const genevaBorder: LngLatBounds = { sw: [5.6, 45.6], ne: [7.6, 46.5] };
    const result = computeAttribution({
      style: 'satellite',
      is3D: true,
      center: [6.6, 46.05],
      zoom: 11,
      bounds: genevaBorder,
    });
    expect(result).toBe('© swisstopo · © IGN · Sentinel-2 cloudless by EOX · Mapzen');
  });

  it('includes regional source attribution when center is in a supported region', () => {
    // Center over Switzerland at zoom that unlocks swisstopo (≥8 per REGIONS)
    const result = computeAttribution({
      style: 'satellite',
      is3D: false,
      center: [8.5, 46.8], // Zurich area
      zoom: 14,
    });
    // Switzerland attribution from swisstopo source
    expect(result.toLowerCase()).toMatch(/swisstopo|swiss/);
  });
});
