import { device, element, by, expect, waitFor } from 'detox';
import {
  waitForElement,
  waitForText,
  tapElement,
  tapText,
  typeInElement,
  expectVisible,
  expectExists,
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

    it('should display activity section in demo mode', async () => {
      await enterDemoMode();
      // Verify the activity list section is visible (header text may not be visible if scrolled)
      await waitForElement('home-activity-list', 10000);
    });

    it('should display demo banner when in demo mode', async () => {
      await enterDemoMode();
      // Wait for the demo banner text to appear
      await waitForText('Demo Mode', 10000);
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

    // NOTE: Activity detail navigation is tested in navigation.test.ts
    // which enters demo mode once in beforeAll for more stable deep link handling.
    // Skipping this redundant test to avoid flakiness from state after reload.
  });

  describe('API key validation', () => {
    it('should show error for invalid API key', async () => {
      // Expand API key section
      await tapText('Use API Key instead');
      await delay(500);

      // Verify input and button exist
      await expectExists('login-apikey-input');
      await expectExists('login-apikey-button');

      // Enter invalid API key to enable the button
      await typeInElement('login-apikey-input', 'invalid-test-key');
      await tapElement('login-apikey-button');

      // Wait for network call to fail and error to appear (may take up to 10s)
      await waitForElement('login-error-text', 15000);
    });
  });
});
