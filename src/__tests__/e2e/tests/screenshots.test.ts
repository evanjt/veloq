import { device, element, by, expect, waitFor } from 'detox';
import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

describe('screenshots', () => {
  beforeAll(async () => {
    // Ensure screenshot directory exists
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    // Launch app fresh and enter demo mode
    await device.launchApp({ newInstance: true });
    // Wait for app to finish initializing (debug builds are slower)
    await waitFor(element(by.id('login-demo-button')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('login-demo-button')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();

    // Wait for data to load
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  it('01-feed: Activity Feed', async () => {
    await expect(element(by.id('home-screen'))).toBeVisible();
    await device.takeScreenshot('01-feed');
  });

  it('02-activity-map: Activity Map', async () => {
    // Tap on first activity in the list
    await element(by.id('home-activity-list')).atIndex(0).tap();
    await expect(element(by.id('activity-detail-screen'))).toBeVisible();

    // Wait for map to render
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await device.takeScreenshot('02-activity-map');
  });

  it('03-charts: Activity Charts', async () => {
    // Scroll down to see charts
    await element(by.id('activity-detail-screen')).scroll(400, 'down');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await device.takeScreenshot('03-charts');
  });

  it('04-fitness: Fitness Tracking', async () => {
    // Go back and navigate to fitness
    await device.pressBack();
    await element(by.text('Fitness')).tap();
    await expect(element(by.id('fitness-screen'))).toBeVisible();

    // Wait for charts to render
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await device.takeScreenshot('04-fitness');
  });

  it('05-routes: Routes', async () => {
    await element(by.text('Routes')).tap();
    await expect(element(by.id('routes-screen'))).toBeVisible();

    // Wait for route data to load
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await device.takeScreenshot('05-routes');
  });

  it('06-performance: Performance Curves', async () => {
    await element(by.text('Performance')).tap();
    await expect(element(by.id('stats-screen'))).toBeVisible();

    // Wait for charts to render
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await device.takeScreenshot('06-performance');
  });

  it('07-regional-map: Regional Map', async () => {
    // Navigate to home first
    await element(by.text('Home')).tap();
    await expect(element(by.id('home-screen'))).toBeVisible();

    // Open map via FAB
    await element(by.id('map-fab')).tap();
    await expect(element(by.id('map-screen'))).toBeVisible();

    // Wait for map tiles to load
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await device.takeScreenshot('07-regional-map');
  });

  it('08-settings: Settings', async () => {
    // Navigate back to home
    await device.pressBack();
    await expect(element(by.id('home-screen'))).toBeVisible();

    // Open settings
    await element(by.id('nav-settings-button')).tap();
    await expect(element(by.id('settings-screen'))).toBeVisible();

    await device.takeScreenshot('08-settings');
  });
});
