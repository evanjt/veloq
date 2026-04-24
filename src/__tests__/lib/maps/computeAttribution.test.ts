/**
 * Tests for computeAttribution — pure attribution-text computation.
 * Imports from `@/components/maps/mapStyles`, which pulls only JSON and
 * pure geometry helpers (no MapLibre). No mocking needed.
 */

import { computeAttribution } from '@/lib/maps/computeAttribution';

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
    expect(result).toContain('Terrain');
    expect(result).toContain('|');
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
    expect(result).toContain('EOX');
    expect(result).toContain('Terrain');
    expect(result).toContain('|');
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
