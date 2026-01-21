/**
 * E2E Test Helpers
 *
 * Utilities for handling common E2E testing challenges:
 * - App synchronization (timers, network requests)
 * - Element visibility with retries
 * - Deep link navigation (preferred for reliability)
 *
 * Key patterns:
 * 1. Use deep links for navigation (veloq://path) - more reliable than tapping
 * 2. Disable synchronization for operations (TanStack Query keeps app "busy")
 * 3. Use waitFor with timeout for element assertions
 */

import { device, element, by, waitFor, expect } from 'detox';

/**
 * Default timeout for element visibility (ms)
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Available deep link routes in the app
 */
export const ROUTES = {
  HOME: '',
  FITNESS: 'fitness',
  ROUTES: 'routes',
  STATS: 'stats',
  SETTINGS: 'settings',
  ABOUT: 'about',
  MAP: 'map',
  LOGIN: 'login',
  HEATMAP: 'heatmap',
  WELLNESS: 'wellness',
  TRAINING: 'training',
  ACTIVITY: (id: string) => `activity/${id}`,
  ROUTE_DETAIL: (id: string) => `route/${id}`,
  SECTION_DETAIL: (id: string) => `section/${id}`,
} as const;

/**
 * Wait for an element to be visible, with synchronization disabled.
 *
 * This is necessary because the app has background timers (TanStack Query,
 * animations) that prevent Detox from ever seeing the app as "idle".
 *
 * @param testID - The testID of the element to wait for
 * @param timeout - Maximum time to wait (default 30s)
 */
export async function waitForElement(
  testID: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<void> {
  await device.disableSynchronization();
  try {
    await waitFor(element(by.id(testID)))
      .toBeVisible()
      .withTimeout(timeout);
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Wait for text to be visible, with synchronization disabled.
 *
 * @param text - The text to wait for
 * @param timeout - Maximum time to wait (default 30s)
 */
export async function waitForText(text: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
  await device.disableSynchronization();
  try {
    await waitFor(element(by.text(text)))
      .toBeVisible()
      .withTimeout(timeout);
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Tap an element by testID, with synchronization disabled.
 *
 * @param testID - The testID of the element to tap
 */
export async function tapElement(testID: string): Promise<void> {
  await device.disableSynchronization();
  try {
    await element(by.id(testID)).tap();
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Tap an element by text, with synchronization disabled.
 *
 * @param text - The text of the element to tap
 */
export async function tapText(text: string): Promise<void> {
  await device.disableSynchronization();
  try {
    await element(by.text(text)).tap();
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Type text into an input field, with synchronization disabled.
 *
 * @param testID - The testID of the input element
 * @param text - The text to type
 */
export async function typeInElement(testID: string, text: string): Promise<void> {
  await device.disableSynchronization();
  try {
    await element(by.id(testID)).typeText(text);
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Assert an element is visible, with synchronization disabled.
 *
 * @param testID - The testID of the element
 */
export async function expectVisible(testID: string): Promise<void> {
  await device.disableSynchronization();
  try {
    await expect(element(by.id(testID))).toBeVisible();
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Assert an element exists (may not be visible), with synchronization disabled.
 *
 * @param testID - The testID of the element
 */
export async function expectExists(testID: string): Promise<void> {
  await device.disableSynchronization();
  try {
    await expect(element(by.id(testID))).toExist();
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Assert text is visible, with synchronization disabled.
 *
 * @param text - The text to check
 */
export async function expectTextVisible(text: string): Promise<void> {
  await device.disableSynchronization();
  try {
    await expect(element(by.text(text))).toBeVisible();
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Launch the app fresh and wait for the login screen.
 * Use this in beforeAll/beforeEach for consistent test setup.
 */
export async function launchAppFresh(): Promise<void> {
  await device.launchApp({ newInstance: true });
  await waitForElement('login-screen');
}

/**
 * Reload React Native and wait for the login screen.
 * Use this between tests to reset app state.
 */
export async function reloadAndWaitForLogin(): Promise<void> {
  await device.reloadReactNative();
  await waitForElement('login-screen');
}

/**
 * Enter demo mode from the login screen.
 * Assumes the login screen is already visible.
 */
export async function enterDemoMode(): Promise<void> {
  await tapElement('login-demo-button');
  await waitForElement('home-screen');
}

/**
 * Navigate to a tab by text label.
 *
 * @param tabLabel - The text label of the tab (e.g., 'Fitness', 'Routes')
 */
export async function navigateToTab(tabLabel: string): Promise<void> {
  await tapText(tabLabel);
}

/**
 * Scroll down in a scrollable element.
 *
 * @param testID - The testID of the scrollable element
 * @param distance - Distance to scroll in pixels
 */
export async function scrollDown(testID: string, distance: number = 500): Promise<void> {
  await device.disableSynchronization();
  try {
    await element(by.id(testID)).scroll(distance, 'down');
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Navigate to a screen via deep link.
 * This is the preferred navigation method as it's more reliable than tapping.
 *
 * @param route - The route path (e.g., 'fitness', 'settings', 'activity/demo-0')
 * @param expectedScreenId - The testID of the expected screen
 * @param timeout - Maximum time to wait for screen to appear
 */
export async function navigateViaDeepLink(
  route: string,
  expectedScreenId: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<void> {
  await device.disableSynchronization();
  try {
    await device.openURL({ url: `veloq://${route}` });
    // Small delay to let navigation complete
    await new Promise((resolve) => setTimeout(resolve, 500));
    await waitFor(element(by.id(expectedScreenId)))
      .toBeVisible()
      .withTimeout(timeout);
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Navigate to a screen via deep link and wait for it to exist (not necessarily visible).
 * Useful for screens that may have loading states.
 *
 * @param route - The route path
 * @param expectedScreenId - The testID of the expected screen
 * @param timeout - Maximum time to wait
 */
export async function navigateViaDeepLinkAndWaitForExist(
  route: string,
  expectedScreenId: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<void> {
  await device.disableSynchronization();
  try {
    await device.openURL({ url: `veloq://${route}` });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await waitFor(element(by.id(expectedScreenId)))
      .toExist()
      .withTimeout(timeout);
  } finally {
    await device.enableSynchronization();
  }
}

/**
 * Small delay helper for waiting for animations/data loading.
 *
 * @param ms - Milliseconds to wait
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
