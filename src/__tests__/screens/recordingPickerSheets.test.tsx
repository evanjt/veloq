/**
 * Scenario: the recorder opens the data field picker for a long-pressed tile and the route
 * overlay picker for the live map, and applies each answer.
 *
 * Expected behaviour: a chosen field lands in the slot that was pressed and leaves the others
 * alone, a field already shown elsewhere swaps places, a dismissed sheet changes nothing, a
 * chosen route becomes the map overlay, "No route" clears it and a dismissed sheet keeps it.
 */
import React from 'react';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';

import RecordingScreen from '@/app/recording/[type]';
import { answerSheet } from '../__shared__/answerSheet';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

const mockPush = jest.fn();
let mockOpenRoutePicker: () => void = () => {};
const mockParams: Record<string, string | undefined> = { type: 'Ride' };
const mockOverlayReads: (string | null)[] = [];

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: { Screen: () => null },
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getCalendarEventBodies: () => [], subscribe: () => () => {} }),
}));
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: jest.fn(),
  replaceTo: jest.fn(),
  goBack: jest.requireActual('@/shared/app/navigation').goBack,
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: <P extends object>(Screen: React.ComponentType<P>) => Screen,
}));
jest.mock('@/features/routes', () => ({
  useRepresentativeRoute: (routeId: string | null) => {
    mockOverlayReads.push(routeId);
    return { points: [] };
  },
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
  })
);
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: ({ onOpenRoutePicker }: { onOpenRoutePicker: () => void }) => {
    mockOpenRoutePicker = onOpenRoutePicker;
    return null;
  },
}));
jest.mock('@/features/recording/components/ConnectedDataFieldGrid', () => ({
  ConnectedDataFieldGrid: ({
    fields,
    onLongPressField,
  }: {
    fields: string[];
    onLongPressField?: (index: number) => void;
  }) => {
    const { Pressable, Text } = require('react-native');
    return fields.map((field, index) => (
      <Pressable key={index} testID={`slot-${index}`} onLongPress={() => onLongPressField?.(index)}>
        <Text testID={`slot-text-${index}`}>{field}</Text>
      </Pressable>
    ));
  },
}));
jest.mock('@/features/recording/hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('@/features/recording/components/UnlockTrack', () => ({
  UnlockTrack: ({ onUnlock }: { onUnlock: () => void }) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="unlock" onPress={onUnlock} />;
  },
}));

let view: Awaited<ReturnType<typeof render>>;
const fieldTexts = () => [0, 1, 2, 3].map((i) => view.getByTestId(`slot-text-${i}`).props.children);

/** Answers the pushed request with `value`, null included, as the route does for "No route". */
async function resolveSheet(value: unknown) {
  mockParams.request = mockPush.mock.calls.at(-1)[0].params.request;
  const sheet = await renderHook(() => useSheetRequest<unknown, unknown>());
  await act(() => sheet.result.current.resolve(value));
  await sheet.unmount();
}

async function renderUnlocked() {
  view = await render(<RecordingScreen />);
  await fireEvent.press(view.getByTestId('unlock'));
}

beforeEach(() => {
  mockPush.mockClear();
  mockOverlayReads.length = 0;
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  useRecordingPreferences
    .getState()
    .setDataFields('gps', ['speed', 'distance', 'heartrate', 'power']);
});

describe('data field picker sheet', () => {
  it('puts the chosen field in the pressed slot and leaves the others', async () => {
    await renderUnlocked();
    void fireEvent(view.getByTestId('slot-2'), 'longPress');
    expect(mockPush.mock.calls.at(-1)[0].pathname).toBe('sheets/field-picker');
    await answerSheet(mockPush, mockParams, 'cadence');
    await waitFor(() => expect(fieldTexts()).toEqual(['speed', 'distance', 'cadence', 'power']));
  });

  it('swaps places with a field already shown in another slot', async () => {
    await renderUnlocked();
    void fireEvent(view.getByTestId('slot-2'), 'longPress');
    await answerSheet(mockPush, mockParams, 'speed');
    await waitFor(() => expect(fieldTexts()).toEqual(['heartrate', 'distance', 'speed', 'power']));
  });

  it('changes nothing when the sheet is dismissed', async () => {
    await renderUnlocked();
    void fireEvent(view.getByTestId('slot-2'), 'longPress');
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(fieldTexts()).toEqual(['speed', 'distance', 'heartrate', 'power']);
  });
});

describe('route overlay picker sheet', () => {
  const lastRead = () => mockOverlayReads.at(-1);

  it('opens with the sport and the current overlay, and applies the chosen route', async () => {
    await renderUnlocked();
    expect(lastRead()).toBeNull();
    await act(() => {
      mockOpenRoutePicker();
    });
    expect(mockPush.mock.calls.at(-1)[0].pathname).toBe('sheets/route-overlay');
    await answerSheet(mockPush, mockParams, 'group-7');
    await waitFor(() => expect(lastRead()).toBe('group-7'));
  });

  it('clears the overlay when "No route" is chosen', async () => {
    await renderUnlocked();
    await act(() => {
      mockOpenRoutePicker();
    });
    await answerSheet(mockPush, mockParams, 'group-7');
    await waitFor(() => expect(lastRead()).toBe('group-7'));
    await act(() => {
      mockOpenRoutePicker();
    });
    await resolveSheet(null);
    await act(async () => {});
    await waitFor(() => expect(lastRead()).toBeNull());
  });

  it('keeps the overlay when the sheet is dismissed', async () => {
    await renderUnlocked();
    await act(() => {
      mockOpenRoutePicker();
    });
    await answerSheet(mockPush, mockParams, 'group-7');
    await waitFor(() => expect(lastRead()).toBe('group-7'));
    await act(() => {
      mockOpenRoutePicker();
    });
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(lastRead()).toBe('group-7');
  });
});
