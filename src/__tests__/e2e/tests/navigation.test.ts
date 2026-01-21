import { device, element, by } from 'detox';
import {
  waitForElement,
  expectVisible,
  launchAppFresh,
  enterDemoMode,
  navigateViaDeepLink,
  navigateViaDeepLinkAndWaitForExist,
  ROUTES,
  delay,
} from '../utils/testHelpers';

/**
 * Navigation Tests
 *
 * Tests navigation between all main screens using deep links for reliability.
 * Deep links bypass UI interaction timing issues that cause flaky tests.
 *
 * All screens should be accessible via veloq:// deep links when authenticated.
 */
describe('Navigation', () => {
  beforeAll(async () => {
    await launchAppFresh();
    // Enter demo mode for navigation tests - this sets auth state
    await enterDemoMode();
  });

  beforeEach(async () => {
    // Return to home before each test for consistent starting state
    await navigateViaDeepLink(ROUTES.HOME, 'home-screen');
  });

  describe('Main tabs', () => {
    it('should navigate to Home screen', async () => {
      await navigateViaDeepLink(ROUTES.HOME, 'home-screen');
      await expectVisible('home-screen');
    });

    it('should navigate to Fitness screen', async () => {
      await navigateViaDeepLink(ROUTES.FITNESS, 'fitness-screen');
      await expectVisible('fitness-screen');
    });

    it('should navigate to Routes screen', async () => {
      await navigateViaDeepLink(ROUTES.ROUTES, 'routes-screen');
      await expectVisible('routes-screen');
    });

    it('should navigate to Performance/Stats screen', async () => {
      await navigateViaDeepLink(ROUTES.STATS, 'stats-screen');
      await expectVisible('stats-screen');
    });
  });

  describe('Secondary screens', () => {
    it('should navigate to Settings screen', async () => {
      await navigateViaDeepLink(ROUTES.SETTINGS, 'settings-screen');
      await expectVisible('settings-screen');
    });

    it('should navigate to About screen', async () => {
      await navigateViaDeepLink(ROUTES.ABOUT, 'about-screen');
      await expectVisible('about-screen');
    });

    it('should navigate to Map screen', async () => {
      await navigateViaDeepLinkAndWaitForExist(ROUTES.MAP, 'map-screen');
      // Map screen loads async data, so we just check it exists
    });

    it('should navigate to Wellness screen', async () => {
      await navigateViaDeepLink(ROUTES.WELLNESS, 'wellness-screen');
      await expectVisible('wellness-screen');
    });

    it('should navigate to Heatmap screen', async () => {
      await navigateViaDeepLinkAndWaitForExist(ROUTES.HEATMAP, 'heatmap-screen');
    });

    it('should navigate to Training screen', async () => {
      await navigateViaDeepLink(ROUTES.TRAINING, 'training-screen');
      await expectVisible('training-screen');
    });
  });

  describe('Activity detail', () => {
    it('should navigate to activity detail via deep link', async () => {
      // demo-0 is the first demo activity
      await navigateViaDeepLink(ROUTES.ACTIVITY('demo-0'), 'activity-detail-screen');
      // Wait for content to load (not just loading/error state)
      await waitForElement('activity-detail-content', 15000);
    });

    it('should navigate to second demo activity', async () => {
      await navigateViaDeepLink(ROUTES.ACTIVITY('demo-1'), 'activity-detail-screen');
      await waitForElement('activity-detail-content', 15000);
    });
  });

  describe('Back navigation', () => {
    it('should navigate back from Fitness to Home', async () => {
      await navigateViaDeepLink(ROUTES.FITNESS, 'fitness-screen');
      await device.pressBack();
      // After back, should return to home
      await delay(500);
      await expectVisible('home-screen');
    });

    it('should navigate back from Settings to Home', async () => {
      await navigateViaDeepLink(ROUTES.SETTINGS, 'settings-screen');
      await device.pressBack();
      await delay(500);
      await expectVisible('home-screen');
    });

    it('should navigate back from Activity to Home', async () => {
      await navigateViaDeepLink(ROUTES.ACTIVITY('demo-0'), 'activity-detail-screen');
      await waitForElement('activity-detail-content', 15000);
      await device.pressBack();
      await delay(500);
      await expectVisible('home-screen');
    });
  });
});
