import { calculateTerrainCamera, isLikelyInterestingTerrain } from '@/lib/utils/cameraAngle';

describe('calculateTerrainCamera', () => {
  // Helper: generate a straight line of coordinates
  function line(
    startLng: number,
    startLat: number,
    endLng: number,
    endLat: number,
    n = 20
  ): [number, number][] {
    const coords: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      coords.push([startLng + t * (endLng - startLng), startLat + t * (endLat - startLat)]);
    }
    return coords;
  }

  // Helper: make a loop (start ≈ end) around a center
  function loop(centerLng: number, centerLat: number, radius = 0.01, n = 40): [number, number][] {
    const coords: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const angle = (2 * Math.PI * i) / n;
      coords.push([centerLng + radius * Math.cos(angle), centerLat + radius * Math.sin(angle)]);
    }
    return coords;
  }

  describe('edge cases', () => {
    it('returns defaults for empty coordinates', () => {
      const result = calculateTerrainCamera([]);
      expect(result.camera).toEqual({ center: [0, 0], zoom: 10, bearing: 0, pitch: 60 });
      expect(result.hasInterestingTerrain).toBe(false);
    });

    it('handles all-NaN coordinates', () => {
      const result = calculateTerrainCamera([
        [NaN, NaN],
        [NaN, NaN],
      ]);
      expect(result.camera.center).toEqual([0, 0]);
      expect(result.hasInterestingTerrain).toBe(false);
    });
  });

  describe('fallback (no altitude)', () => {
    it('uses perpendicular bearing when no altitude provided', () => {
      // West to east route (bearing ~90°), perpendicular = 180°
      const coords = line(10, 45, 11, 45);
      const result = calculateTerrainCamera(coords);
      expect(result.camera.pitch).toBe(60);
      // Route goes east (bearing ~90°), perpendicular is ~180°
      expect(result.camera.bearing).toBeCloseTo(180, 0);
      expect(result.hasInterestingTerrain).toBe(false);
    });
  });

  describe('flat route fallback (<30m range)', () => {
    it('falls back to perpendicular bearing when elevation range < 30m', () => {
      const coords = line(10, 45, 11, 45, 10);
      // 20m range — below threshold
      const altitude = Array.from({ length: 10 }, (_, i) => 100 + (i / 9) * 20);
      const result = calculateTerrainCamera(coords, altitude);
      expect(result.camera.pitch).toBe(60); // fallback pitch
      expect(result.hasInterestingTerrain).toBe(false);
    });
  });

  describe('elevation-aware camera', () => {
    it('points toward high terrain on a mountain climb', () => {
      // Route goes north (lat increases), altitude increases with latitude
      const coords = line(10, 45, 10, 46, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 500 + (i / 19) * 1500);
      // Range: 500m to 2000m (1500m range)
      const result = calculateTerrainCamera(coords, altitude);

      // High terrain is to the NORTH (high lat). Camera should look toward north.
      // Bearing toward high terrain ≈ 0° (north)
      // Accept within ±30° of north (0° or 360°)
      const b = result.camera.bearing;
      expect(b < 30 || b > 330).toBe(true);

      // Mountainous pitch
      expect(result.camera.pitch).toBe(52);
      expect(result.hasInterestingTerrain).toBe(true);
      expect(result.elevationRange).toBe(1500);
    });

    it('handles loop routes well (camera faces summit side)', () => {
      // Loop centered at (10, 45), with a summit on the north side
      const coords = loop(10, 45, 0.02, 40);
      const altitude = coords.map(([, lat]) => {
        // Higher altitude for points north of center
        return 500 + Math.max(0, (lat - 45) * 50000);
      });

      const result = calculateTerrainCamera(coords, altitude);
      // Should look toward north (where high terrain is)
      const b = result.camera.bearing;
      expect(b < 60 || b > 300).toBe(true);
      expect(result.camera.pitch).not.toBe(60); // Not fallback
      expect(result.hasInterestingTerrain).toBe(true);
    });
  });

  describe('center offset', () => {
    it('shifts center away from high terrain', () => {
      // Route goes north, altitude increases to the north
      const coords = line(10, 45, 10, 46, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 500 + (i / 19) * 1500);

      const resultWithAlt = calculateTerrainCamera(coords, altitude);
      const resultNoAlt = calculateTerrainCamera(coords);

      // Without altitude, center is exactly bbox midpoint
      const bboxCenterLat = (45 + 46) / 2;
      expect(resultNoAlt.camera.center[1]).toBeCloseTo(bboxCenterLat, 5);

      // With altitude looking north, center should shift SOUTH (away from high terrain)
      expect(resultWithAlt.camera.center[1]).toBeLessThan(bboxCenterLat);
    });
  });

  describe('adaptive pitch', () => {
    it('uses 62° pitch for moderate elevation (< 100m range)', () => {
      const coords = line(10, 45, 10.1, 45.1, 20);
      // 80m range — above flat threshold, below medium
      const altitude = Array.from({ length: 20 }, (_, i) => 200 + (i / 19) * 80);
      const result = calculateTerrainCamera(coords, altitude);
      expect(result.camera.pitch).toBe(62);
    });

    it('uses 52° pitch for mountainous terrain (> 400m range)', () => {
      const coords = line(10, 45, 10.1, 45.1, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 200 + (i / 19) * 1000);
      const result = calculateTerrainCamera(coords, altitude);
      expect(result.camera.pitch).toBe(52);
    });
  });

  describe('zoom adjustment', () => {
    it('never goes below minimum zoom of 8', () => {
      // Very large route already at low zoom
      const coords = line(-10, 30, 20, 60, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 100 + (i / 19) * 3000);
      const result = calculateTerrainCamera(coords, altitude);
      expect(result.camera.zoom).toBeGreaterThanOrEqual(8);
    });
  });

  describe('bearing normalization', () => {
    it('returns bearing in 0-360 range', () => {
      const coords = line(10, 45, 10.1, 45.1, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 200 + (i / 19) * 500);
      const result = calculateTerrainCamera(coords, altitude);
      expect(result.camera.bearing).toBeGreaterThanOrEqual(0);
      expect(result.camera.bearing).toBeLessThan(360);
    });
  });

  describe('robustness', () => {
    it('handles NaN values in altitude array', () => {
      const coords = line(10, 45, 11, 46, 10);
      const altitude = [500, NaN, 600, NaN, 800, 900, NaN, 1200, 1500, 2000];
      const result = calculateTerrainCamera(coords, altitude);
      // Should still work with valid points
      expect(result.camera.pitch).not.toBe(60); // elevation-aware
      expect(result.hasInterestingTerrain).toBe(true);
    });
  });
});

describe('isLikelyInterestingTerrain', () => {
  it('returns false for flat city walk (17m gain, 4.6km)', () => {
    expect(isLikelyInterestingTerrain(17, 4600)).toBe(false);
  });

  it('returns true for mountain route (147m gain, 12.6km)', () => {
    expect(isLikelyInterestingTerrain(147, 12600)).toBe(true);
  });

  it('returns false for high-altitude plateau (low gain per km)', () => {
    // 25m gain over 20km — flat despite being at altitude
    expect(isLikelyInterestingTerrain(25, 20000)).toBe(false);
  });

  it('returns false for very low gain (< 30m)', () => {
    expect(isLikelyInterestingTerrain(15, 500)).toBe(false);
  });

  it('returns true for short steep activity', () => {
    // 50m gain over 800m — steep but short
    expect(isLikelyInterestingTerrain(50, 800)).toBe(true);
  });

  it('returns false for long flat activity with low gain/km', () => {
    // 40m gain over 50km — 0.8 m/km
    expect(isLikelyInterestingTerrain(40, 50000)).toBe(false);
  });

  it('handles invalid inputs gracefully', () => {
    expect(isLikelyInterestingTerrain(NaN, 1000)).toBe(false);
    expect(isLikelyInterestingTerrain(100, NaN)).toBe(true); // distance NaN but gain is fine
    expect(isLikelyInterestingTerrain(0, 0)).toBe(false);
  });
});
