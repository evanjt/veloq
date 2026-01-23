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
    // NOTE: device.pressBack() is Android-only
    // On iOS, back navigation requires tapping the back button element
    // These tests use deep link to return home since that's more reliable cross-platform

    it('should be able to navigate away from Fitness', async () => {
      await navigateViaDeepLink(ROUTES.FITNESS, 'fitness-screen');
      await expectVisible('fitness-screen');
      // Navigate back to home via deep link (cross-platform reliable)
      await navigateViaDeepLink(ROUTES.HOME, 'home-screen');
      await expectVisible('home-screen');
    });

    it('should be able to navigate away from Settings', async () => {
      await navigateViaDeepLink(ROUTES.SETTINGS, 'settings-screen');
      await expectVisible('settings-screen');
      // Navigate back to home via deep link
      await navigateViaDeepLink(ROUTES.HOME, 'home-screen');
      await expectVisible('home-screen');
    });

    it('should be able to navigate away from About', async () => {
      await navigateViaDeepLink(ROUTES.ABOUT, 'about-screen');
      await expectVisible('about-screen');
      // Navigate back to home via deep link
      await navigateViaDeepLink(ROUTES.HOME, 'home-screen');
      await expectVisible('home-screen');
    });
  });
});
