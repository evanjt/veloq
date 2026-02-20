import { calculateTerrainCamera } from '@/lib/utils/cameraAngle';

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
      const camera = calculateTerrainCamera([]);
      expect(camera).toEqual({ center: [0, 0], zoom: 10, bearing: 0, pitch: 60 });
    });

    it('returns defaults for single coordinate', () => {
      const camera = calculateTerrainCamera([[10, 45]]);
      expect(camera).toEqual({ center: [10, 45], zoom: 13, bearing: 0, pitch: 60 });
    });

    it('handles all-NaN coordinates', () => {
      const camera = calculateTerrainCamera([
        [NaN, NaN],
        [NaN, NaN],
      ]);
      expect(camera.center).toEqual([0, 0]);
    });
  });

  describe('fallback (no altitude)', () => {
    it('uses perpendicular bearing when no altitude provided', () => {
      // West to east route (bearing ~90°), perpendicular = 180°
      const coords = line(10, 45, 11, 45);
      const camera = calculateTerrainCamera(coords);
      expect(camera.pitch).toBe(60);
      // Route goes east (bearing ~90°), perpendicular is ~180°
      expect(camera.bearing).toBeCloseTo(180, 0);
    });

    it('uses perpendicular bearing when altitude is undefined', () => {
      const coords = line(10, 45, 11, 45);
      const camera = calculateTerrainCamera(coords, undefined);
      expect(camera.pitch).toBe(60);
    });

    it('uses perpendicular bearing when altitude is empty', () => {
      const coords = line(10, 45, 11, 45);
      const camera = calculateTerrainCamera(coords, []);
      expect(camera.pitch).toBe(60);
    });
  });

  describe('flat route fallback (<30m range)', () => {
    it('falls back to perpendicular bearing when elevation range < 30m', () => {
      const coords = line(10, 45, 11, 45, 10);
      // 20m range — below threshold
      const altitude = Array.from({ length: 10 }, (_, i) => 100 + (i / 9) * 20);
      const camera = calculateTerrainCamera(coords, altitude);
      expect(camera.pitch).toBe(60); // fallback pitch
    });

    it('falls back when all altitudes are identical', () => {
      const coords = line(10, 45, 11, 45, 10);
      const altitude = new Array(10).fill(500);
      const camera = calculateTerrainCamera(coords, altitude);
      expect(camera.pitch).toBe(60); // fallback pitch
    });
  });

  describe('elevation-aware camera', () => {
    it('points toward high terrain on a mountain climb', () => {
      // Route goes north (lat increases), altitude increases with latitude
      const coords = line(10, 45, 10, 46, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 500 + (i / 19) * 1500);
      // Range: 500m to 2000m (1500m range)
      const camera = calculateTerrainCamera(coords, altitude);

      // High terrain is to the NORTH (high lat). Camera should look toward north.
      // Bearing toward high terrain ≈ 0° (north)
      // Accept within ±30° of north (0° or 360°)
      const b = camera.bearing;
      expect(b < 30 || b > 330).toBe(true);

      // Mountainous pitch
      expect(camera.pitch).toBe(52);
    });

    it('looks toward high end on an asymmetric climb', () => {
      // Route goes east, altitude rises steeply in the second half
      const n = 20;
      const coords = line(10, 45, 11, 45, n);
      // Exponential rise: mostly flat then steep climb to 1200m
      const altitude = Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1);
        return 200 + 1000 * t * t; // 200 → 1200, weighted toward end
      });

      const camera = calculateTerrainCamera(coords, altitude);
      // High terrain is to the east. Bearing should point roughly east (~90°)
      expect(camera.bearing).toBeGreaterThan(45);
      expect(camera.bearing).toBeLessThan(135);
      expect(camera.pitch).not.toBe(60); // elevation-aware
    });

    it('handles loop routes well (camera faces summit side)', () => {
      // Loop centered at (10, 45), with a summit on the north side
      const coords = loop(10, 45, 0.02, 40);
      const altitude = coords.map(([, lat]) => {
        // Higher altitude for points north of center
        return 500 + Math.max(0, (lat - 45) * 50000);
      });

      const camera = calculateTerrainCamera(coords, altitude);
      // Should look toward north (where high terrain is)
      const b = camera.bearing;
      expect(b < 60 || b > 300).toBe(true);
      expect(camera.pitch).not.toBe(60); // Not fallback
    });
  });

  describe('center offset', () => {
    it('shifts center away from high terrain', () => {
      // Route goes north, altitude increases to the north
      const coords = line(10, 45, 10, 46, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 500 + (i / 19) * 1500);

      const cameraWithAlt = calculateTerrainCamera(coords, altitude);
      const cameraNoAlt = calculateTerrainCamera(coords);

      // Without altitude, center is exactly bbox midpoint
      const bboxCenterLat = (45 + 46) / 2;
      expect(cameraNoAlt.center[1]).toBeCloseTo(bboxCenterLat, 5);

      // With altitude looking north, center should shift SOUTH (away from high terrain)
      expect(cameraWithAlt.center[1]).toBeLessThan(bboxCenterLat);
    });
  });

  describe('adaptive pitch', () => {
    it('uses 62° pitch for moderate elevation (< 100m range)', () => {
      const coords = line(10, 45, 10.1, 45.1, 20);
      // 80m range — above flat threshold, below medium
      const altitude = Array.from({ length: 20 }, (_, i) => 200 + (i / 19) * 80);
      const camera = calculateTerrainCamera(coords, altitude);
      expect(camera.pitch).toBe(62);
    });

    it('uses 58° pitch for medium elevation (100-400m range)', () => {
      const coords = line(10, 45, 10.1, 45.1, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 200 + (i / 19) * 250);
      const camera = calculateTerrainCamera(coords, altitude);
      expect(camera.pitch).toBe(58);
    });

    it('uses 52° pitch for mountainous terrain (> 400m range)', () => {
      const coords = line(10, 45, 10.1, 45.1, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 200 + (i / 19) * 1000);
      const camera = calculateTerrainCamera(coords, altitude);
      expect(camera.pitch).toBe(52);
    });
  });

  describe('zoom adjustment', () => {
    it('reduces zoom by 0.5 for elevation range > 300m', () => {
      // Small route so zoom is well above 8 (min clamp)
      const coords = line(10, 45, 10.05, 45.05, 20);
      const noAltCamera = calculateTerrainCamera(coords);
      const highAlt = Array.from({ length: 20 }, (_, i) => 100 + (i / 19) * 500);
      const highCamera = calculateTerrainCamera(coords, highAlt);

      // Elevation-aware with >300m range should reduce zoom by 0.5
      expect(highCamera.zoom).toBeLessThan(noAltCamera.zoom);
    });

    it('never goes below minimum zoom of 8', () => {
      // Very large route already at low zoom
      const coords = line(-10, 30, 20, 60, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 100 + (i / 19) * 3000);
      const camera = calculateTerrainCamera(coords, altitude);
      expect(camera.zoom).toBeGreaterThanOrEqual(8);
    });
  });

  describe('bearing normalization', () => {
    it('returns bearing in 0-360 range', () => {
      const coords = line(10, 45, 10.1, 45.1, 20);
      const altitude = Array.from({ length: 20 }, (_, i) => 200 + (i / 19) * 500);
      const camera = calculateTerrainCamera(coords, altitude);
      expect(camera.bearing).toBeGreaterThanOrEqual(0);
      expect(camera.bearing).toBeLessThan(360);
    });
  });

  describe('robustness', () => {
    it('handles NaN values in altitude array', () => {
      const coords = line(10, 45, 11, 46, 10);
      const altitude = [500, NaN, 600, NaN, 800, 900, NaN, 1200, 1500, 2000];
      const camera = calculateTerrainCamera(coords, altitude);
      // Should still work with valid points
      expect(camera.pitch).not.toBe(60); // elevation-aware
    });

    it('handles altitude array shorter than coordinates', () => {
      const coords = line(10, 45, 11, 46, 20);
      const altitude = Array.from({ length: 10 }, (_, i) => 500 + (i / 9) * 1500);
      const camera = calculateTerrainCamera(coords, altitude);
      // Uses min(coords.length, altitude.length) = 10 points
      expect(camera.pitch).not.toBe(60);
    });

    it('handles altitude array longer than coordinates', () => {
      const coords = line(10, 45, 11, 46, 10);
      const altitude = Array.from({ length: 20 }, (_, i) => 500 + (i / 19) * 1500);
      const camera = calculateTerrainCamera(coords, altitude);
      expect(camera.pitch).not.toBe(60);
    });
  });
});
