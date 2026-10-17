/**
 * Scenario: the non-GPS review screen sits under a native header that takes a collapsing large
 * title on iOS. `contentInsetAdjustmentBehavior: 'automatic'` adds the home-indicator inset, and the
 * review is a stack screen where the tab bar does not draw.
 *
 * Expected behaviour: rendered on iOS under a bottom safe area, the scroll view lets the system
 * inset its content and adds no bottom padding of its own. Android insets no scroll view and the
 * app draws edge to edge, so there the scroll view pads its end by the navigation bar, and the
 * hold-to-discard at the end of the form scrolls clear of it.
 */

import React from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import ReviewScreen from '@/app/recording/review';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { headerLargeTitle } from '@/shared/app/screenHeaders';
import { inStack } from '../__shared__/testStack';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
  useSegments: () => ['recording', 'review'],
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
let mockBottomInset = 34;
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: mockBottomInset, left: 0, right: 0 }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
  })
);
jest.mock('@/features/recording/components/ReviewMapHero', () => ({ ReviewMapHero: () => null }));
jest.mock('@/features/recording/hooks/useReviewSave', () => ({
  useReviewSave: () => ({
    isUploading: false,
    isProcessing: false,
    leaving: false,
    saveError: null,
    handleSave: jest.fn(),
    handleDiscard: jest.fn(),
    clearSaveError: jest.fn(),
  }),
}));

const platform = Platform.OS;
afterEach(() => {
  Platform.OS = platform;
  mockBottomInset = 34;
});

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  useRecordingStore.setState({ athleteId: 'i1' });
});

describe('review screen scroll view', () => {
  it('takes a large title on iOS', () => {
    expect(headerLargeTitle('recording/review', 'ios')).toBe(true);
    expect(headerLargeTitle('recording/review', 'android')).toBe(false);
  });

  it('insets the system way and pads nothing for a tab bar', async () => {
    Platform.OS = 'ios';
    const { UNSAFE_getAllByType } = await render(inStack(<ReviewScreen />));

    const scroll = UNSAFE_getAllByType(ScrollView)[0];
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom ?? 0).toBe(0);
  });

  it('pads the end of the form by the navigation bar on Android', async () => {
    Platform.OS = 'android';
    mockBottomInset = 48;
    const { UNSAFE_getAllByType } = await render(inStack(<ReviewScreen />));

    const scroll = UNSAFE_getAllByType(ScrollView)[0];
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(48);
  });
});
