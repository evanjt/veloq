/**
 * Scenario: the recordings list sits under a native header that takes a collapsing large title on
 * iOS. `contentInsetAdjustmentBehavior: 'automatic'` adds the home-indicator inset, so the list
 * content pads by the tab bar clearance alone.
 *
 * Expected behaviour: rendered on iOS under a bottom safe area, the list lets the system inset its
 * content and pads by the tab bar clearance alone.
 */

import React from 'react';
import { FlatList, Platform, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import RecordingsLibraryScreen from '@/app/recordings/index';
import { headerLargeTitle } from '@/shared/app/screenHeaders';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/features/recording/components/PermissionUpgradeBanner', () => ({
  PermissionUpgradeBanner: () => null,
}));
jest.mock('@/features/recording/hooks/useRecordingLibrary', () => ({
  useRecordingLibrary: () => ({
    entries: [],
    isLoading: false,
    uploadingId: null,
    uploadNow: jest.fn(),
    remove: jest.fn(),
    refresh: jest.fn(),
  }),
}));

describe('recordings list', () => {
  it('takes a large title on iOS', () => {
    expect(headerLargeTitle('recordings/index', 'ios')).toBe(true);
    expect(headerLargeTitle('recordings/index', 'android')).toBe(false);
  });

  it('insets the system way and pads by the tab bar clearance alone', () => {
    Platform.OS = 'ios';
    const { UNSAFE_getByType } = render(<RecordingsLibraryScreen />);

    const list = UNSAFE_getByType(FlatList);
    expect(list.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(
      TAB_BAR_SAFE_PADDING
    );
  });
});
