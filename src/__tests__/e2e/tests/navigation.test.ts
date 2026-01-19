import { device, element, by, expect, waitFor } from 'detox';

describe('Navigation', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Wait for app to finish initializing (debug builds are slower)
    await waitFor(element(by.id('login-demo-button')))
      .toBeVisible()
      .withTimeout(30000);
    // Enter demo mode first
    await element(by.id('login-demo-button')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();
  });

  it('should navigate to Fitness screen', async () => {
    await element(by.text('Fitness')).tap();
    await expect(element(by.id('fitness-screen'))).toBeVisible();
  });

  it('should navigate back from Fitness screen', async () => {
    await element(by.text('Fitness')).tap();
    await expect(element(by.id('fitness-screen'))).toBeVisible();
    await device.pressBack();
    await expect(element(by.id('home-screen'))).toBeVisible();
  });

  it('should navigate to Routes screen', async () => {
    await element(by.text('Routes')).tap();
    await expect(element(by.id('routes-screen'))).toBeVisible();
  });

  it('should navigate to Performance/Stats screen', async () => {
    await element(by.text('Performance')).tap();
    await expect(element(by.id('stats-screen'))).toBeVisible();
  });

  it('should open activity detail from list', async () => {
    // Go back to home first
    await element(by.text('Home')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();

    // Tap on first activity
    await element(by.id('home-activity-list')).atIndex(0).tap();
    await expect(element(by.id('activity-detail-screen'))).toBeVisible();
  });

  it('should navigate to regional map via FAB', async () => {
    // Go back to home first
    await element(by.text('Home')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();

    // Tap on map FAB
    await element(by.id('map-fab')).tap();
    await expect(element(by.id('map-screen'))).toBeVisible();
  });

  it('should navigate to settings', async () => {
    // Go back to home first
    await element(by.text('Home')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();

    // Tap on profile/settings button
    await element(by.id('nav-settings-button')).tap();
    await expect(element(by.id('settings-screen'))).toBeVisible();
  });

  it('should navigate to about screen from settings', async () => {
    // Navigate to settings
    await element(by.text('Home')).tap();
    await element(by.id('nav-settings-button')).tap();
    await expect(element(by.id('settings-screen'))).toBeVisible();

    // Scroll down and tap About
    await element(by.id('settings-screen')).scroll(500, 'down');
    await element(by.text('About & Legal')).tap();
    await expect(element(by.id('about-screen'))).toBeVisible();
  });
});
