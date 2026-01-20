import { device, element, by } from 'detox';
import {
  waitForElement,
  tapElement,
  tapText,
  expectVisible,
  launchAppFresh,
  enterDemoMode,
  navigateToTab,
  scrollDown,
} from '../utils/testHelpers';

describe('Navigation', () => {
  beforeAll(async () => {
    await launchAppFresh();
    // Enter demo mode for navigation tests
    await enterDemoMode();
  });

  it('should navigate to Fitness screen', async () => {
    await navigateToTab('Fitness');
    await expectVisible('fitness-screen');
  });

  it('should navigate back from Fitness screen', async () => {
    await navigateToTab('Fitness');
    await expectVisible('fitness-screen');
    await device.pressBack();
    await expectVisible('home-screen');
  });

  it('should navigate to Routes screen', async () => {
    await navigateToTab('Routes');
    await expectVisible('routes-screen');
  });

  it('should navigate to Performance/Stats screen', async () => {
    await navigateToTab('Performance');
    await expectVisible('stats-screen');
  });

  it('should open activity detail from list', async () => {
    // Go back to home first
    await navigateToTab('Home');
    await expectVisible('home-screen');

    // Tap on first activity in the list
    // Note: Using atIndex(0) to get the first item
    await device.disableSynchronization();
    try {
      await element(by.id('home-activity-list')).atIndex(0).tap();
    } finally {
      await device.enableSynchronization();
    }
    await expectVisible('activity-detail-screen');
  });

  it('should navigate to regional map via FAB', async () => {
    // Go back to home first
    await navigateToTab('Home');
    await expectVisible('home-screen');

    // Tap on map FAB
    await tapElement('map-fab');
    await expectVisible('map-screen');
  });

  it('should navigate to settings', async () => {
    // Go back to home first
    await navigateToTab('Home');
    await expectVisible('home-screen');

    // Tap on profile/settings button
    await tapElement('nav-settings-button');
    await expectVisible('settings-screen');
  });

  it('should navigate to about screen from settings', async () => {
    // Navigate to settings
    await navigateToTab('Home');
    await tapElement('nav-settings-button');
    await expectVisible('settings-screen');

    // Scroll down and tap About
    await scrollDown('settings-screen');
    await tapText('About & Legal');
    await expectVisible('about-screen');
  });
});
