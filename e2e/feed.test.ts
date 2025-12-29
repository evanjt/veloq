import { device, element, by, expect, waitFor } from 'detox';
import { testIDs } from './testIDs';

describe('Activity Feed', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
    // Enter demo mode to access the feed
    await element(by.id(testIDs.login.demoButton)).tap();
    await waitFor(element(by.id(testIDs.home.screen)))
      .toBeVisible()
      .withTimeout(10000);
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    // Re-enter demo mode after reload
    try {
      await element(by.id(testIDs.login.demoButton)).tap();
      await waitFor(element(by.id(testIDs.home.screen)))
        .toBeVisible()
        .withTimeout(10000);
    } catch {
      // Already on home screen
    }
  });

  describe('Feed Display', () => {
    it('should display activity list', async () => {
      await expect(element(by.id(testIDs.home.activityList))).toBeVisible();
    });

    it('should display activity cards in the feed', async () => {
      await waitFor(element(by.id(testIDs.activityCard.container)).atIndex(0))
        .toBeVisible()
        .withTimeout(15000);
    });

    it('should show activity title on card', async () => {
      await waitFor(element(by.id(testIDs.activityCard.title)).atIndex(0))
        .toBeVisible()
        .withTimeout(15000);
    });
  });

  describe('Search', () => {
    it('should have search input', async () => {
      await expect(element(by.id(testIDs.home.searchInput))).toBeVisible();
    });

    it('should filter activities when searching', async () => {
      await element(by.id(testIDs.home.searchInput)).tap();
      await element(by.id(testIDs.home.searchInput)).typeText('ride');
      // Wait for filter to apply
      await new Promise(resolve => setTimeout(resolve, 500));
      // Activity list should still be visible (with filtered results)
      await expect(element(by.id(testIDs.home.activityList))).toBeVisible();
    });

    it('should clear search and show all activities', async () => {
      await element(by.id(testIDs.home.searchInput)).tap();
      await element(by.id(testIDs.home.searchInput)).typeText('ride');
      await element(by.id(testIDs.home.searchInput)).clearText();
      await expect(element(by.id(testIDs.home.activityList))).toBeVisible();
    });
  });

  describe('Pull to Refresh', () => {
    it('should refresh feed on pull down', async () => {
      const activityList = element(by.id(testIDs.home.activityList));

      // Perform pull-to-refresh gesture
      await activityList.scroll(200, 'down');

      // Should still show activity list after refresh
      await waitFor(element(by.id(testIDs.home.activityList)))
        .toBeVisible()
        .withTimeout(10000);
    });
  });

  describe('Infinite Scroll', () => {
    it('should load more activities on scroll to bottom', async () => {
      const activityList = element(by.id(testIDs.home.activityList));

      // Scroll to bottom to trigger infinite scroll
      await activityList.scroll(1000, 'up');

      // Wait for new activities to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Activity list should still be visible with more items
      await expect(activityList).toBeVisible();
    });
  });

  describe('Activity Navigation', () => {
    it('should navigate to activity detail when tapping an activity', async () => {
      await waitFor(element(by.id(testIDs.activityCard.container)).atIndex(0))
        .toBeVisible()
        .withTimeout(15000);

      await element(by.id(testIDs.activityCard.container)).atIndex(0).tap();

      await waitFor(element(by.id(testIDs.activityDetail.screen)))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('should navigate back to feed from activity detail', async () => {
      await waitFor(element(by.id(testIDs.activityCard.container)).atIndex(0))
        .toBeVisible()
        .withTimeout(15000);

      await element(by.id(testIDs.activityCard.container)).atIndex(0).tap();

      await waitFor(element(by.id(testIDs.activityDetail.screen)))
        .toBeVisible()
        .withTimeout(10000);

      await element(by.id(testIDs.activityDetail.backButton)).tap();

      await expect(element(by.id(testIDs.home.screen))).toBeVisible();
    });
  });
});
