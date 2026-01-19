import { device, element, by, expect } from 'detox';

/**
 * Wait for an element to be visible with a custom timeout
 */
export async function waitForElement(testID: string, timeout: number = 10000): Promise<void> {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .withTimeout(timeout);
}

/**
 * Enter demo mode from a fresh app start
 */
export async function enterDemoMode(): Promise<void> {
  await expect(element(by.id('login-screen'))).toBeVisible();
  await element(by.id('login-demo-button')).tap();
  await expect(element(by.id('home-screen'))).toBeVisible();
}

/**
 * Navigate to a screen using bottom tab
 */
export async function navigateToTab(
  tabName: 'Home' | 'Fitness' | 'Routes' | 'Performance'
): Promise<void> {
  await element(by.text(tabName)).tap();
}

/**
 * Navigate to settings via profile button
 */
export async function navigateToSettings(): Promise<void> {
  await element(by.id('nav-settings-button')).tap();
  await expect(element(by.id('settings-screen'))).toBeVisible();
}

/**
 * Navigate to regional map via FAB
 */
export async function navigateToMap(): Promise<void> {
  await element(by.id('map-fab')).tap();
  await expect(element(by.id('map-screen'))).toBeVisible();
}

/**
 * Open the first activity from the home screen list
 */
export async function openFirstActivity(): Promise<void> {
  await element(by.id('home-activity-list')).atIndex(0).tap();
  await expect(element(by.id('activity-detail-screen'))).toBeVisible();
}

/**
 * Delay helper for waiting for animations/data loading
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scroll down on a scrollable element
 */
export async function scrollDown(testID: string, pixels: number = 500): Promise<void> {
  await element(by.id(testID)).scroll(pixels, 'down');
}

/**
 * Scroll up on a scrollable element
 */
export async function scrollUp(testID: string, pixels: number = 500): Promise<void> {
  await element(by.id(testID)).scroll(pixels, 'up');
}
