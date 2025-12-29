import { device, element, by, expect } from 'detox';
import { testIDs } from './testIDs';

describe('Authentication Flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  describe('Login Screen', () => {
    it('should show login screen on first launch', async () => {
      await expect(element(by.id(testIDs.login.screen))).toBeVisible();
    });

    it('should have API key input field', async () => {
      await expect(element(by.id(testIDs.login.apiKeyInput))).toBeVisible();
    });

    it('should have login button', async () => {
      await expect(element(by.id(testIDs.login.loginButton))).toBeVisible();
    });

    it('should have demo mode button', async () => {
      await expect(element(by.id(testIDs.login.demoButton))).toBeVisible();
    });

    it('should show error when submitting empty API key', async () => {
      await element(by.id(testIDs.login.loginButton)).tap();
      await expect(element(by.id(testIDs.login.errorText))).toBeVisible();
    });
  });

  describe('Demo Mode', () => {
    it('should navigate to home screen when tapping demo button', async () => {
      await element(by.id(testIDs.login.demoButton)).tap();
      await expect(element(by.id(testIDs.home.screen))).toBeVisible();
    });

    it('should show demo banner in demo mode', async () => {
      await element(by.id(testIDs.login.demoButton)).tap();
      await expect(element(by.text('Demo Mode'))).toBeVisible();
    });
  });

  describe('Logout', () => {
    beforeEach(async () => {
      // Enter demo mode first
      await element(by.id(testIDs.login.demoButton)).tap();
      await expect(element(by.id(testIDs.home.screen))).toBeVisible();
    });

    it('should navigate to settings', async () => {
      await element(by.id(testIDs.nav.settingsButton)).tap();
      await expect(element(by.id(testIDs.settings.screen))).toBeVisible();
    });

    it('should logout and return to login screen', async () => {
      await element(by.id(testIDs.nav.settingsButton)).tap();
      await element(by.id(testIDs.settings.logoutButton)).tap();
      await expect(element(by.id(testIDs.login.screen))).toBeVisible();
    });
  });
});
