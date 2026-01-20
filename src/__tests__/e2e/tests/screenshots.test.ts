import { device, element, by, expect, waitFor } from 'detox';
import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

// Helper to navigate to a screen via deep link using openURL (doesn't restart app)
async function navigateViaDeepLink(urlPath: string, screenId: string, timeout = 10000) {
  await device.openURL({ url: `veloq://${urlPath}` });
  // Small delay to let navigation complete
  await new Promise((resolve) => setTimeout(resolve, 500));
  await waitFor(element(by.id(screenId)))
    .toBeVisible()
    .withTimeout(timeout);
}

interface ScreenshotConfig {
  theme: 'light' | 'dark';
  mapStyle: 'light' | 'dark' | 'satellite';
  enable3D: boolean;
}

// Default configuration
const defaultConfig: ScreenshotConfig = {
  theme: 'light',
  mapStyle: 'light',
  enable3D: false,
};

// Parse configuration from environment or use defaults
function getConfig(): ScreenshotConfig {
  return {
    theme: (process.env.SCREENSHOT_THEME as 'light' | 'dark') || defaultConfig.theme,
    mapStyle:
      (process.env.SCREENSHOT_MAP_STYLE as 'light' | 'dark' | 'satellite') ||
      defaultConfig.mapStyle,
    enable3D: process.env.SCREENSHOT_3D === 'true' || defaultConfig.enable3D,
  };
}

describe('screenshots', () => {
  const config = getConfig();
  const suffix = config.theme === 'dark' ? '-dark' : '';

  beforeAll(async () => {
    // Ensure screenshot directory exists
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    // Launch app fresh
    await device.launchApp({ newInstance: true });

    // Disable synchronization to avoid FabricTimersIdlingResource timeout
    // The app has background timers (TanStack Query, animations) that keep it "busy"
    await device.disableSynchronization();

    // Wait for app to finish initializing (debug builds are slower)
    await waitFor(element(by.id('login-demo-button')))
      .toBeVisible()
      .withTimeout(30000);

    // Enter demo mode first
    await element(by.id('login-demo-button')).tap();
    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(10000);

    // Navigate to settings to configure appearance
    await navigateViaDeepLink('settings', 'settings-screen');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Hide demo banner for clean screenshots
    try {
      // Scroll down until we find the demo banner switch (it's near the bottom)
      await waitFor(element(by.id('hide-demo-banner-switch')))
        .toBeVisible()
        .whileElement(by.id('settings-scrollview'))
        .scroll(300, 'down');
      await element(by.id('hide-demo-banner-switch')).tap();
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch {
      console.log('Could not hide demo banner, continuing with banner visible');
    }

    // Configure theme if dark mode is requested
    if (config.theme === 'dark') {
      // Scroll up to find the theme toggle
      try {
        await waitFor(element(by.id('theme-button-dark')))
          .toBeVisible()
          .whileElement(by.id('settings-scrollview'))
          .scroll(300, 'up');
        await element(by.id('theme-button-dark')).tap();
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch {
        console.log('Could not set dark theme via UI, continuing with default');
      }
    }

    // Go back to home
    await navigateViaDeepLink('', 'home-screen');

    // Wait for data to load
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  afterAll(async () => {
    // Re-enable synchronization for other tests
    await device.enableSynchronization();
  });

  it(`01-feed${suffix}: Activity Feed`, async () => {
    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(5000);
    await device.takeScreenshot(`01-feed${suffix}`);
  });

  it(`02-activity-map${suffix}: Activity Map`, async () => {
    // Navigate to home first to ensure we're in demo mode with data loaded
    await navigateViaDeepLink('', 'home-screen');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Tap on first demo activity card (activity-card-demo-0)
    await waitFor(element(by.id('activity-card-demo-0')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('activity-card-demo-0')).tap();

    // Wait for actual content to load (not just the loading/error screen)
    await waitFor(element(by.id('activity-detail-content')))
      .toBeVisible()
      .withTimeout(15000);

    // Configure map style if not default
    if (config.mapStyle !== 'light') {
      // Tap style toggle until we get the desired style
      // Style cycle: light -> dark -> satellite -> light
      const styleTaps = config.mapStyle === 'dark' ? 1 : config.mapStyle === 'satellite' ? 2 : 0;
      for (let i = 0; i < styleTaps; i++) {
        try {
          await element(by.id('map-style-toggle')).tap();
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
          // Style toggle might not be visible, continue
        }
      }
    }

    // Enable 3D mode if requested
    if (config.enable3D) {
      try {
        await element(by.id('map-3d-toggle')).tap();
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for 3D to load
      } catch {
        // 3D toggle might not be visible
      }
    }

    // Wait for map to render
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await device.takeScreenshot(`02-activity-map${suffix}`);
  });

  it(`03-charts${suffix}: Activity Charts`, async () => {
    // Charts are visible below the map (42% of screen height) - no scroll needed
    // Wait for content to be loaded (not loading/error state)
    await waitFor(element(by.id('activity-detail-content')))
      .toBeVisible()
      .withTimeout(10000);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await device.takeScreenshot(`03-charts${suffix}`);
  });

  it(`04-fitness${suffix}: Fitness Tracking`, async () => {
    await navigateViaDeepLink('fitness', 'fitness-screen');

    // Wait for charts to render
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await device.takeScreenshot(`04-fitness${suffix}`);
  });

  it(`05-routes${suffix}: Routes`, async () => {
    await navigateViaDeepLink('routes', 'routes-screen');

    // Wait for route data to load
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await device.takeScreenshot(`05-routes${suffix}`);
  });

  it(`06-performance${suffix}: Performance Curves`, async () => {
    await navigateViaDeepLink('stats', 'stats-screen');

    // Wait for charts to render
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await device.takeScreenshot(`06-performance${suffix}`);
  });

  it(`07-regional-map${suffix}: Regional Map`, async () => {
    // Use deep link to navigate directly to map (more reliable than FAB on iOS)
    await device.openURL({ url: 'veloq://map' });
    // Map screen loads data asynchronously - wait for testID with long timeout
    await waitFor(element(by.id('map-screen')))
      .toExist()
      .withTimeout(30000);

    // Configure map style for regional map
    if (config.mapStyle !== 'light') {
      const styleTaps = config.mapStyle === 'dark' ? 1 : config.mapStyle === 'satellite' ? 2 : 0;
      for (let i = 0; i < styleTaps; i++) {
        try {
          await element(by.id('map-style-toggle')).tap();
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch {
          // Style toggle might not be visible
        }
      }
    }

    // Wait for map tiles to load
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await device.takeScreenshot(`07-regional-map${suffix}`);
  });

  it(`08-settings${suffix}: Settings`, async () => {
    await navigateViaDeepLink('settings', 'settings-screen', 5000);
    await device.takeScreenshot(`08-settings${suffix}`);
  });
});
