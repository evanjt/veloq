import { device, element, by, waitFor } from 'detox';
import { launchAppFresh, enterDemoMode, ROUTES, delay } from '../utils/testHelpers';

/**
 * Performance Tests
 *
 * Measures navigation timing between screens to catch performance regressions.
 * These tests ensure navigation remains snappy after code changes.
 *
 * Thresholds:
 * - Fast screens (<500ms): Home, Fitness, Training, Routes
 * - Medium screens (<1000ms): Settings, Map, Wellness
 * - Slow screens (<2000ms): Activity detail (loads GPS data)
 */

// Performance thresholds in milliseconds
const THRESHOLDS = {
  FAST: 500, // Simple screens with minimal data
  MEDIUM: 1000, // Screens with moderate data loading
  SLOW: 2000, // Screens with heavy data (GPS, maps)
};

/**
 * Measure time to navigate to a screen and have it become visible
 */
async function measureNavigation(
  route: string,
  screenId: string,
  timeout: number = 15000
): Promise<number> {
  const start = Date.now();

  await device.openURL({ url: `veloq://${route}` });

  await waitFor(element(by.id(screenId)))
    .toBeVisible()
    .withTimeout(timeout);

  const elapsed = Date.now() - start;
  return elapsed;
}

/**
 * Measure time for screen to show content (not just container)
 */
async function measureNavigationWithContent(
  route: string,
  screenId: string,
  contentId: string,
  timeout: number = 15000
): Promise<{ screenTime: number; contentTime: number }> {
  const start = Date.now();

  await device.openURL({ url: `veloq://${route}` });

  await waitFor(element(by.id(screenId)))
    .toBeVisible()
    .withTimeout(timeout);

  const screenTime = Date.now() - start;

  await waitFor(element(by.id(contentId)))
    .toExist()
    .withTimeout(timeout);

  const contentTime = Date.now() - start;

  return { screenTime, contentTime };
}

describe('Performance', () => {
  beforeAll(async () => {
    await launchAppFresh();
    await enterDemoMode();
  });

  beforeEach(async () => {
    // Start from home before each measurement
    await device.openURL({ url: `veloq://${ROUTES.HOME}` });
    await delay(300); // Let previous screen unmount
  });

  describe('Navigation timing', () => {
    it('should navigate to Home quickly', async () => {
      // Navigate away first
      await device.openURL({ url: `veloq://${ROUTES.SETTINGS}` });
      await delay(500);

      const time = await measureNavigation(ROUTES.HOME, 'home-screen');
      console.log(`[PERF] Home: ${time}ms`);
      expect(time).toBeLessThan(THRESHOLDS.FAST);
    });

    it('should navigate to Fitness within threshold', async () => {
      const time = await measureNavigation(ROUTES.FITNESS, 'fitness-screen');
      console.log(`[PERF] Fitness: ${time}ms`);
      expect(time).toBeLessThan(THRESHOLDS.FAST);
    });

    it('should navigate to Training within threshold', async () => {
      const time = await measureNavigation(ROUTES.TRAINING, 'training-screen');
      console.log(`[PERF] Training: ${time}ms`);
      expect(time).toBeLessThan(THRESHOLDS.FAST);
    });

    it('should navigate to Routes within threshold', async () => {
      const time = await measureNavigation(ROUTES.ROUTES, 'routes-screen');
      console.log(`[PERF] Routes: ${time}ms`);
      expect(time).toBeLessThan(THRESHOLDS.FAST);
    });

    it('should navigate to Settings within threshold', async () => {
      const time = await measureNavigation(ROUTES.SETTINGS, 'settings-screen');
      console.log(`[PERF] Settings: ${time}ms`);
      expect(time).toBeLessThan(THRESHOLDS.MEDIUM);
    });

    it('should navigate to Wellness within threshold', async () => {
      const time = await measureNavigation(ROUTES.WELLNESS, 'wellness-screen');
      console.log(`[PERF] Wellness: ${time}ms`);
      expect(time).toBeLessThan(THRESHOLDS.MEDIUM);
    });

    it('should navigate to Map within threshold', async () => {
      const time = await measureNavigation(ROUTES.MAP, 'map-screen');
      console.log(`[PERF] Map: ${time}ms`);
      expect(time).toBeLessThan(THRESHOLDS.MEDIUM);
    });
  });

  describe('Content loading timing', () => {
    it('should load activity detail content within threshold', async () => {
      const { screenTime, contentTime } = await measureNavigationWithContent(
        ROUTES.ACTIVITY('demo-0'),
        'activity-detail-screen',
        'activity-detail-content'
      );
      console.log(`[PERF] Activity detail: screen=${screenTime}ms, content=${contentTime}ms`);
      expect(screenTime).toBeLessThan(THRESHOLDS.FAST);
      expect(contentTime).toBeLessThan(THRESHOLDS.SLOW);
    });
  });

  describe('Rapid navigation', () => {
    it('should handle rapid navigation without lag accumulation', async () => {
      const screens = [
        { route: ROUTES.FITNESS, id: 'fitness-screen' },
        { route: ROUTES.TRAINING, id: 'training-screen' },
        { route: ROUTES.SETTINGS, id: 'settings-screen' },
        { route: ROUTES.WELLNESS, id: 'wellness-screen' },
        { route: ROUTES.HOME, id: 'home-screen' },
      ];

      const times: number[] = [];

      for (const screen of screens) {
        const time = await measureNavigation(screen.route, screen.id);
        times.push(time);
        console.log(`[PERF] Rapid nav to ${screen.route || 'home'}: ${time}ms`);
      }

      // Average should stay under MEDIUM threshold even with rapid navigation
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`[PERF] Rapid navigation average: ${avg.toFixed(0)}ms`);
      expect(avg).toBeLessThan(THRESHOLDS.MEDIUM);

      // No single navigation should exceed SLOW threshold
      const max = Math.max(...times);
      console.log(`[PERF] Rapid navigation max: ${max}ms`);
      expect(max).toBeLessThan(THRESHOLDS.SLOW);
    });
  });

  describe('Cold vs warm navigation', () => {
    it('should show improved times on second navigation (screen caching)', async () => {
      // First navigation - cold
      await device.openURL({ url: `veloq://${ROUTES.SETTINGS}` });
      await delay(500);

      const cold = await measureNavigation(ROUTES.FITNESS, 'fitness-screen');
      console.log(`[PERF] Fitness cold: ${cold}ms`);

      // Navigate away
      await device.openURL({ url: `veloq://${ROUTES.HOME}` });
      await delay(300);

      // Second navigation - warm (screen should be cached with enableFreeze)
      const warm = await measureNavigation(ROUTES.FITNESS, 'fitness-screen');
      console.log(`[PERF] Fitness warm: ${warm}ms`);

      // Both should be fast, warm ideally faster due to screen freeze
      expect(cold).toBeLessThan(THRESHOLDS.MEDIUM);
      expect(warm).toBeLessThan(THRESHOLDS.MEDIUM);

      // Log improvement for visibility
      if (warm < cold) {
        console.log(
          `[PERF] Screen caching saved ${cold - warm}ms (${(((cold - warm) / cold) * 100).toFixed(0)}%)`
        );
      }
    });
  });
});
