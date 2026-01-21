import { device, element, by, expect, waitFor } from 'detox';
import {
  waitForElement,
  tapElement,
  tapText,
  typeInElement,
  expectVisible,
  expectExists,
  expectTextVisible,
  launchAppFresh,
  reloadAndWaitForLogin,
  enterDemoMode,
  navigateViaDeepLink,
  ROUTES,
  delay,
} from '../utils/testHelpers';

/**
 * Demo Mode Tests
 *
 * Tests the demo mode entry flow and login screen functionality.
 * These tests use tapping for login interactions (testing the actual user flow)
 * and deep links for navigation after authentication.
 */
describe('Demo Mode', () => {
  beforeAll(async () => {
    await launchAppFresh();
  });

  beforeEach(async () => {
    await reloadAndWaitForLogin();
  });

  describe('Login screen', () => {
    it('should display login screen elements on fresh start', async () => {
      await expectVisible('login-screen');
      await expectVisible('login-oauth-button');
      await expectVisible('login-demo-button');
    });

    it('should have API key section expandable', async () => {
      // API key section should be collapsible
      await tapText('Use API Key instead');
      await expectExists('login-apikey-input');
      await expectExists('login-apikey-button');
    });
  });

  describe('Demo mode entry', () => {
    it('should enter demo mode when tapping demo button', async () => {
      await enterDemoMode();
      await expectVisible('home-screen');
    });

    it('should display "Recent Activities" heading in demo mode', async () => {
      await enterDemoMode();
      await expectTextVisible('Recent Activities');
    });

    it('should display demo banner when in demo mode', async () => {
      await enterDemoMode();
      await expectTextVisible('Demo Mode');
    });

    it('should show activity list with demo data', async () => {
      await enterDemoMode();
      await expectVisible('home-activity-list');
    });
  });

  describe('Demo mode navigation', () => {
    it('should be able to access all screens after entering demo mode', async () => {
      await enterDemoMode();

      // Navigate to fitness via deep link
      await navigateViaDeepLink(ROUTES.FITNESS, 'fitness-screen');
      await expectVisible('fitness-screen');

      // Navigate back to home
      await navigateViaDeepLink(ROUTES.HOME, 'home-screen');
      await expectVisible('home-screen');
    });

    it('should be able to view demo activity detail', async () => {
      await enterDemoMode();
      await navigateViaDeepLink(ROUTES.ACTIVITY('demo-0'), 'activity-detail-screen');
      await waitForElement('activity-detail-content', 15000);
    });
  });

  describe('API key validation', () => {
    it('should show error for invalid API key', async () => {
      // Expand API key section
      await tapText('Use API Key instead');
      await delay(300);

      // Verify input and button exist
      await expectExists('login-apikey-input');
      await expectExists('login-apikey-button');

      // Enter invalid API key (too short) to enable the button
      await typeInElement('login-apikey-input', 'test');
      await tapElement('login-apikey-button');

      // Error should be visible (invalid API key format or auth failure)
      await expectVisible('login-error-text');
    });
  });
});
