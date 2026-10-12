/**
 * Scenario: the recording route doubles as the manual form, the strength form and the planned
 * strength follow, and swipe-back is off on it, so whatever draws back is the only way off.
 *
 * Expected behaviour: each form takes the platform's header, titled with the sport, and draws no
 * back arrow of its own. The live recorder takes no header.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import RecordingScreen from '@/app/recording/[type]';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';

let mockParams: Record<string, string | undefined> = {};
const mockStackScreen = jest.fn();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mockStackScreen(options);
      return null;
    },
  },
  router: { replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useSegments: () => ['recording', '[type]'],
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: <P extends object>(Screen: React.ComponentType<P>) => Screen,
}));
jest.mock('@/features/recording/lib/plannedWorkout', () => ({
  readPlannedWorkout: (eventId: number) =>
    eventId === 7
      ? { name: 'Circuit', lines: [{ kind: 'work', text: 'Squats', durationSeconds: 60 }] }
      : null,
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    useAlwaysLocationPrompt: () => undefined,
    useCanRecord: () => ({ canRecord: true, reason: 'ok' }),
    usePermissionUpgrade: () => ({
      upgradePermissions: jest.fn(),
      isUpgrading: false,
      error: null,
    }),
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
  })
);
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: () => null,
}));
jest.mock('@/features/recording/hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('@/features/recording/components/DataFieldGrid', () => ({
  DataFieldGrid: () => null,
}));

function lastOptions(): Record<string, unknown> {
  expect(mockStackScreen).toHaveBeenCalled();
  return mockStackScreen.mock.calls[mockStackScreen.mock.calls.length - 1][0];
}

const BACK_GLYPHS = ['arrow-left', 'chevron-left', 'arrow-back'];

function drawsNoBackGlyph() {
  for (const name of BACK_GLYPHS) {
    expect(screen.UNSAFE_queryAllByProps({ name })).toHaveLength(0);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
});

afterEach(() => {
  useRecordingStore.getState().reset();
});

it.each([
  ['the manual form', { type: 'Yoga' }, 'activityTypes.Yoga', 'manual-entry-duration'],
  ['the strength form', { type: 'WeightTraining' }, 'activityTypes.WeightTraining', null],
  [
    'the planned strength follow',
    { type: 'WeightTraining', pairedEventId: '7' },
    'activityTypes.WeightTraining',
    'strength-follow',
  ],
])('gives %s the native header titled with the sport', async (_label, params, title, testID) => {
  mockParams = params;
  await render(<RecordingScreen />);

  if (testID) expect(screen.getByTestId(testID)).toBeTruthy();
  expect(lastOptions()).toMatchObject({ headerShown: true, title });
  drawsNoBackGlyph();
});

it('gives the live recorder no header', async () => {
  mockParams = { type: 'Ride' };
  await render(<RecordingScreen />);

  expect(screen.getByTestId('recording-unlock-slot')).toBeTruthy();
  expect(lastOptions()).toMatchObject({ headerShown: false });
});
