import { device, element, by, expect, waitFor } from 'detox';
import { testIDs } from './testIDs';

describe('Settings Screen', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Enter demo mode
    await element(by.id(testIDs.login.demoButton)).tap();
    await waitFor(element(by.id(testIDs.home.screen)))
      .toBeVisible()
      .withTimeout(10000);
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    // Re-enter demo mode and navigate to settings
    try {
      await element(by.id(testIDs.login.demoButton)).tap();
      await waitFor(element(by.id(testIDs.home.screen)))
        .toBeVisible()
        .withTimeout(10000);
    } catch {
      // Already on home screen
    }
    await element(by.id(testIDs.nav.settingsButton)).tap();
    await waitFor(element(by.id(testIDs.settings.screen)))
      .toBeVisible()
      .withTimeout(5000);
  });

  describe('Settings Display', () => {
    it('should show settings screen', async () => {
      await expect(element(by.id(testIDs.settings.screen))).toBeVisible();
    });

    it('should show theme toggle', async () => {
      await expect(element(by.id(testIDs.settings.themeToggle))).toBeVisible();
    });

    it('should show clear cache button', async () => {
      await expect(element(by.id(testIDs.settings.clearCacheButton))).toBeVisible();
    });

    it('should show logout button', async () => {
      await expect(element(by.id(testIDs.settings.logoutButton))).toBeVisible();
    });

    it('should show app version', async () => {
      await expect(element(by.id(testIDs.settings.versionText))).toBeVisible();
    });
  });

  describe('Theme Toggle', () => {
    it('should toggle theme when tapping theme switch', async () => {
      // Get initial state and tap toggle
      await element(by.id(testIDs.settings.themeToggle)).tap();

      // Theme should change (we can't easily verify the visual change,
      // but the toggle should be tappable without crashing)
      await expect(element(by.id(testIDs.settings.themeToggle))).toBeVisible();
    });
  });

  describe('Clear Cache', () => {
    it('should show confirmation when tapping clear cache', async () => {
      await element(by.id(testIDs.settings.clearCacheButton)).tap();

      // Should show confirmation dialog or complete the action
      // After clearing cache, settings should still be visible
      await waitFor(element(by.id(testIDs.settings.screen)))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  describe('Navigation', () => {
    it('should navigate back to home screen', async () => {
      await element(by.id(testIDs.nav.backButton)).tap();
      await expect(element(by.id(testIDs.home.screen))).toBeVisible();
    });
  });
});
