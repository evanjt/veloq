import { device, element, by, expect } from 'detox';
import {
  waitForElement,
  waitForText,
  tapElement,
  tapText,
  typeInElement,
  expectVisible,
  expectExists,
  expectTextVisible,
  launchAppFresh,
  reloadAndWaitForLogin,
  enterDemoMode,
} from '../utils/testHelpers';

describe('Demo Mode', () => {
  beforeAll(async () => {
    await launchAppFresh();
  });

  beforeEach(async () => {
    await reloadAndWaitForLogin();
  });

  it('should display login screen on fresh start', async () => {
    await expectVisible('login-screen');
    await expectVisible('login-oauth-button');
    await expectVisible('login-demo-button');
  });

  it('should enter demo mode when tapping demo button', async () => {
    await enterDemoMode();
    await expectVisible('home-screen');
    await expectTextVisible('Recent Activities');
  });

  it('should display demo banner in demo mode', async () => {
    await enterDemoMode();
    await expectTextVisible('Demo Mode');
  });

  it('should show activity list in demo mode', async () => {
    await enterDemoMode();
    await expectVisible('home-activity-list');
  });

  it('should show API key error for invalid input', async () => {
    // Expand API key section
    await tapText('Use API Key instead');

    // Verify button exists (it's disabled when empty, so we can't tap it)
    await expectExists('login-apikey-button');

    // Enter invalid API key (too short) to enable the button
    await typeInElement('login-apikey-input', 'test');
    await tapElement('login-apikey-button');

    // Error should be visible (invalid API key)
    await expectVisible('login-error-text');
  });
});
