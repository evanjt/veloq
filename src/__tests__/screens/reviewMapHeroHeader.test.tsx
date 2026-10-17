/**
 * Scenario: a GPS ride opens review on a full-bleed map hero, like the activity, route and section
 * detail screens.
 *
 * Expected behaviour: the platform's header floats transparent over the hero and is the only back
 * control, hidden with the swipe while an upload is in flight. The hero draws no back arrow.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import ReviewScreen from '@/app/recording/review';
import { ReviewMapHero } from '@/features/recording/components/ReviewMapHero';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { OVER_MAP_TITLE_COLOR, mapHeroChrome } from '@/shared/app/screenHeaders';

const mockStackScreen = jest.fn();
let mockUploading = false;

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mockStackScreen(options);
      return null;
    },
  },
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
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
jest.mock('@/features/recording/components/RecordingMap', () => ({ RecordingMap: () => null }));
jest.mock('@/features/recording/hooks/useReviewSave', () => ({
  useReviewSave: () => ({
    isUploading: mockUploading,
    isProcessing: mockUploading,
    leaving: false,
    saveError: null,
    handleSave: jest.fn(),
    handleDiscard: jest.fn(),
    clearSaveError: jest.fn(),
  }),
}));

function lastOptions(): Record<string, unknown> {
  expect(mockStackScreen).toHaveBeenCalled();
  return mockStackScreen.mock.calls[mockStackScreen.mock.calls.length - 1][0];
}

function stopRide(points: number) {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  const start = useRecordingStore.getState().startTime!;
  for (let i = 0; i < points; i++) {
    useRecordingStore.getState().addGpsPoint({
      latitude: 46.5 + i * 0.00005,
      longitude: 6.6,
      altitude: 400,
      accuracy: 5,
      speed: 5,
      heading: 0,
      timestamp: start + i * 1000,
    });
  }
  useRecordingStore.getState().stopRecording();
  useRecordingStore.setState({ athleteId: 'i1' });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploading = false;
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  useRecordingStore.getState().reset();
});

afterEach(() => {
  useRecordingStore.getState().reset();
});

describe('GPS review header', () => {
  it('lays the native header transparent over the hero, visually untitled with the hero tint', async () => {
    stopRide(3);
    await render(<ReviewScreen />);

    expect(lastOptions()).toMatchObject({
      headerShown: true,
      headerTransparent: true,
      headerTitleStyle: { color: OVER_MAP_TITLE_COLOR },
      headerLargeTitle: false,
      headerTintColor: mapHeroChrome({ scrolledPastHero: false, isDark: false }).tint,
      headerBackVisible: true,
      gestureEnabled: true,
    });
  });

  it('hides the header back and the swipe while uploading', async () => {
    mockUploading = true;
    stopRide(3);
    await render(<ReviewScreen />);

    expect(lastOptions()).toMatchObject({
      headerTransparent: true,
      headerBackVisible: false,
      gestureEnabled: false,
    });
  });

  it('draws no back arrow on the review screen or its hero', async () => {
    stopRide(3);
    await render(<ReviewScreen />);
    expect(screen.UNSAFE_queryAllByProps({ name: 'arrow-left' })).toHaveLength(0);

    await screen.unmount();
    await render(
      <ReviewMapHero
        coordinates={[
          [46.5, 6.6],
          [46.501, 6.6],
        ]}
        mapHeight={300}
        topInset={47}
        canTrim={false}
        trimStart={0}
        trimEnd={1}
        mapTrimStart={0}
        mapTrimEnd={1}
        totalDuration={60}
        totalPoints={2}
        onTrimChange={jest.fn()}
        onTrimCommit={jest.fn()}
      />
    );
    expect(screen.UNSAFE_queryAllByProps({ name: 'arrow-left' })).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByProps({ accessibilityLabel: 'common.back' })).toHaveLength(0);
  });

  it('keeps the opaque native header on a review with no track', async () => {
    stopRide(0);
    await render(<ReviewScreen />);

    const options = lastOptions();
    expect(options).toMatchObject({ headerShown: true, headerBackVisible: true });
    expect(options.headerTransparent).toBeUndefined();
  });
});
