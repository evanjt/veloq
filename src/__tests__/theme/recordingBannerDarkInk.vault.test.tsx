/**
 * Scenario: the battery nudge and the upload permission banner sit on an amber
 * ground in the dark theme, and drew their words and close mark in the light
 * theme's deep amber, about 2:1 on that ground.
 *
 * Expected behaviour: with the dark theme active, every text colour each banner
 * resolves clears 4.5:1 on the warning ground, and every icon 3:1. The buttons
 * draw on their own fill and are measured with the button.
 */

import React from 'react';
import { Platform } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { BatteryOptimisationNudge } from '@/features/recording/components/BatteryOptimisationNudge';
import { PermissionUpgradeBanner } from '@/features/recording/components/PermissionUpgradeBanner';
import { noticePalette } from '@/shared/ui/NoticeBanner';

import { textCount, themed, underBar } from '../__shared__/drawnContrast';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: true }) }));
jest.mock('@/shared/ui/Button', () => {
  const { View } = require('react-native');
  return { ...jest.requireActual('@/shared/ui/Button'), Button: () => <View /> };
});
jest.mock('@/features/recording/stores/RecordingPreferencesStore', () => ({
  useRecordingPreferences: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ batteryOptDismissed: false, isLoaded: true, dismissBatteryOptNudge: () => {} }),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ authMethod: 'oauth' }),
}));
jest.mock('@/features/recording/stores/UploadPermissionStore', () => ({
  useUploadPermissionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ hasWritePermission: false, bannerDismissed: false, dismissBanner: () => {} }),
}));
jest.mock('@/features/recording/hooks/usePermissionUpgrade', () => ({
  usePermissionUpgrade: () => ({
    upgradePermissions: () => {},
    isUpgrading: false,
    error: 'The permission request was refused.',
  }),
}));

/** The warning ground both banners sit on in the dark theme. */
const AMBER_GROUND = noticePalette('warning', true).bg;

describe('the recording banners in the dark theme', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Platform.OS = 'android';
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('draws the battery nudge words and close mark clear of their bars', async () => {
    await render(themed(<BatteryOptimisationNudge />, true));

    expect(screen.getByTestId('battery-opt-nudge')).toBeTruthy();
    expect(textCount()).toBeGreaterThan(0);
    expect(underBar(AMBER_GROUND)).toEqual([]);
  });

  it('draws the permission banner words, error and close mark clear of their bars', async () => {
    await render(themed(<PermissionUpgradeBanner />, true));

    expect(screen.getByTestId('permission-upgrade-banner')).toBeTruthy();
    expect(textCount()).toBeGreaterThan(1);
    expect(underBar(AMBER_GROUND)).toEqual([]);
  });
});
