import { device, element, by, expect, waitFor } from 'detox';

describe('Demo Mode', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    // Wait for app to finish initializing (debug builds are slower)
    await waitFor(element(by.id('login-screen')))
      .toBeVisible()
      .withTimeout(30000);
  });

  it('should display login screen on fresh start', async () => {
    await expect(element(by.id('login-screen'))).toBeVisible();
    await expect(element(by.id('login-oauth-button'))).toBeVisible();
    await expect(element(by.id('login-demo-button'))).toBeVisible();
  });

  it('should enter demo mode when tapping demo button', async () => {
    await element(by.id('login-demo-button')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();
    await expect(element(by.text('Recent Activities'))).toBeVisible();
  });

  it('should display demo banner in demo mode', async () => {
    await element(by.id('login-demo-button')).tap();
    await expect(element(by.text('Demo Mode'))).toBeVisible();
  });

  it('should show activity list in demo mode', async () => {
    await element(by.id('login-demo-button')).tap();
    await expect(element(by.id('home-activity-list'))).toBeVisible();
  });

  it('should show API key error for invalid input', async () => {
    // Expand API key section
    await element(by.text('Use API Key instead')).tap();

    // Verify button exists (it's disabled when empty, so we can't tap it)
    await expect(element(by.id('login-apikey-button'))).toExist();

    // Enter invalid API key (too short) to enable the button
    await element(by.id('login-apikey-input')).typeText('test');
    await element(by.id('login-apikey-button')).tap();

    // Error should be visible (invalid API key)
    await expect(element(by.id('login-error-text'))).toBeVisible();
  });
});
