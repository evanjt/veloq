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
 * Wait for an element to be visible.
 *
 * NOTE: Synchronization should already be disabled globally via launchAppFresh().
 * This function no longer toggles sync on/off per operation.
 *
 * @param testID - The testID of the element to wait for
 * @param timeout - Maximum time to wait (default 30s)
 */
export async function waitForElement(
  testID: string,
  timeout: number = DEFAULT_TIMEOUT
): Promise<void> {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .withTimeout(timeout);
}

/**
 * Wait for text to be visible.
 *
 * @param text - The text to wait for
 * @param timeout - Maximum time to wait (default 30s)
 */
export async function waitForText(text: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
  await waitFor(element(by.text(text)))
    .toBeVisible()
    .withTimeout(timeout);
}

/**
 * Tap an element by testID.
 *
 * @param testID - The testID of the element to tap
 */
export async function tapElement(testID: string): Promise<void> {
  await element(by.id(testID)).tap();
}

/**
 * Tap an element by text.
 *
 * @param text - The text of the element to tap
 */
export async function tapText(text: string): Promise<void> {
  await element(by.text(text)).tap();
}

/**
 * Type text into an input field.
 *
 * @param testID - The testID of the input element
 * @param text - The text to type
 */
export async function typeInElement(testID: string, text: string): Promise<void> {
  await element(by.id(testID)).typeText(text);
}

/**
 * Assert an element is visible.
 *
 * @param testID - The testID of the element
 */
export async function expectVisible(testID: string): Promise<void> {
  await expect(element(by.id(testID))).toBeVisible();
}

/**
 * Assert an element exists (may not be visible).
 *
 * @param testID - The testID of the element
 */
export async function expectExists(testID: string): Promise<void> {
  await expect(element(by.id(testID))).toExist();
}

/**
 * Assert text is visible.
 *
 * @param text - The text to check
 */
export async function expectTextVisible(text: string): Promise<void> {
  await expect(element(by.text(text))).toBeVisible();
}

/**
 * Launch the app fresh and wait for the login screen.
 * Use this in beforeAll/beforeEach for consistent test setup.
 *
 * IMPORTANT: Due to TanStack Query background timers that keep the JS thread busy,
 * we must use detach: true to skip Detox's idle waiting entirely.
 */
export async function launchAppFresh(): Promise<void> {
  // Launch with detach: true to skip idle synchronization
  // This is necessary because TanStack Query keeps the JS thread "busy"
  // Note: detach is a valid runtime option but not in Detox types
  await device.launchApp({
    newInstance: true,
    detach: true,
    launchArgs: { detoxDisableSynchronization: 1 },
  } as Parameters<typeof device.launchApp>[0]);

  // Also call the API method to ensure sync stays disabled for all operations
  await device.disableSynchronization();

  // Wait for React Native to boot and render (since we skipped idle waiting)
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Now wait for login screen
  await waitFor(element(by.id('login-screen')))
    .toBeVisible()
    .withTimeout(60000);
}

/**
 * Reload React Native and wait for the login screen.
 * Use this between tests to reset app state.
 *
 * IMPORTANT: Sync must already be disabled from launchAppFresh.
 */
export async function reloadAndWaitForLogin(): Promise<void> {
  // Reload React Native - sync should already be disabled
  await device.reloadReactNative();

  // Wait for RN to settle after reload
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Wait for login screen
  await waitFor(element(by.id('login-screen')))
    .toBeVisible()
    .withTimeout(30000);
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
  await element(by.id(testID)).scroll(distance, 'down');
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
  await device.openURL({ url: `veloq://${route}` });
  // Small delay to let navigation complete
  await new Promise((resolve) => setTimeout(resolve, 500));
  await waitFor(element(by.id(expectedScreenId)))
    .toBeVisible()
    .withTimeout(timeout);
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
  await device.openURL({ url: `veloq://${route}` });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await waitFor(element(by.id(expectedScreenId)))
    .toExist()
    .withTimeout(timeout);
}

/**
 * Small delay helper for waiting for animations/data loading.
 *
 * @param ms - Milliseconds to wait
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
