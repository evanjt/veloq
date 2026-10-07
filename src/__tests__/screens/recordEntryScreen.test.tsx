/**
 * Scenario: the record button lands on the entry screen, and a tap there has to
 * read as a response before the clock appears. The tap used to start the ride
 * on arrival with nothing between, and raised the notification prompt over the
 * screen it opened.
 *
 * Expected behaviour: Start navigates to the armed recording screen and does
 * nothing else, the chips choose the sport it starts, and today's planned
 * workouts follow the engine's calendar announcement.
 */
import React from 'react';
import { Platform, StyleSheet, type ViewStyle } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import RecordScreen from '@/app/record';
import { initializeI18n } from '@/i18n';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';
import { useAuthStore } from '@/shared/app/AuthStore';
import { navigateTo } from '@/shared/app/navigation';
import type { CalendarEvent } from '@/types';

type Listener = (payload?: unknown) => void;
const mockListeners: Record<string, Listener[]> = {};
let mockEvents: CalendarEvent[] = [];

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    syncCalendarEvents: jest.fn(),
    subscribe: (event: string, listener: Listener) => {
      (mockListeners[event] ??= []).push(listener);
      return () => {
        mockListeners[event] = mockListeners[event].filter((l) => l !== listener);
      };
    },
  }),
}));
jest.mock('@/features/home/lib/calendarEvents', () => ({
  readCalendarEvents: () => mockEvents,
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  requestNotificationPermission: jest.fn(async () => true),
}));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(() => new Promise(() => {})),
  watchPositionAsync: jest.fn(() => new Promise(() => {})),
}));
const mockOpenedSheets: { route: string; input: unknown; settle: (result: unknown) => void }[] = [];
jest.mock('@/shared/app/sheetRequest', () => ({
  useSheetOpener: () => (route: string, input: unknown) =>
    new Promise((resolve) => {
      mockOpenedSheets.push({ route, input, settle: resolve });
    }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: { Screen: () => null },
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useScreenSafeAreaEdges: () => ['top', 'bottom', 'left', 'right'],
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    RecordingMap: jest.requireMock('@/features/recording/components/RecordingMap').RecordingMap,
    useRecordingPreferences: jest.requireActual(
      '@/features/recording/stores/RecordingPreferencesStore'
    ).useRecordingPreferences,
    RecordingGate: () => null,
    useCanRecord: () => ({ canRecord: true, reason: 'ok' }),
    usePermissionUpgrade: () => ({
      upgradePermissions: jest.fn(),
      isUpgrading: false,
      error: null,
    }),
    promptInterruptedRecording: jest.fn(async () => undefined),
    sessionReturnRoute: jest.requireActual('@/features/recording/lib/sessionReturnRoute')
      .sessionReturnRoute,
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
  })
);
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: () => {
    const { Text: MockText } = require('react-native');
    return <MockText testID="recording-map">map</MockText>;
  },
}));

const planned: CalendarEvent = {
  id: 77,
  name: 'Threshold 3 x 4 min',
  type: 'Run',
  moving_time: 2400,
} as CalendarEvent;

beforeAll(async () => {
  await initializeI18n('en-AU');
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenedSheets.length = 0;
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockEvents = [];
  useRecordingStore.getState().reset();
  useRecordingPreferences.setState({ isLoaded: true, recentActivityTypes: [] });
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true, authMethod: 'apiKey' });
});

describe('a Start tap is answered at once', () => {
  const platform = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'android';
  });
  afterEach(() => {
    Platform.OS = platform;
  });

  it('asks for notifications on arrival once location is answered, never on the tap', async () => {
    let answerLocation!: (answer: { status: string }) => void;
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'undetermined',
    });
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerLocation = resolve;
        })
    );
    render(<RecordScreen />);

    await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled());
    expect(requestNotificationPermission).not.toHaveBeenCalled();

    await act(async () => {
      answerLocation({ status: 'granted' });
    });
    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('record-start'));
    expect(navigateTo).toHaveBeenCalledWith('/recording/Ride?from=entry');
    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing when a live session sends the athlete straight back to it', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    render(<RecordScreen />);

    await act(async () => {});
    expect(requestNotificationPermission).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('navigates to the armed recording screen and does nothing else', () => {
    render(<RecordScreen />);
    (requestNotificationPermission as jest.Mock).mockClear();

    fireEvent.press(screen.getByTestId('record-start'));

    expect(navigateTo).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith('/recording/Ride?from=entry');
    expect(requestNotificationPermission).not.toHaveBeenCalled();
    expect(useRecordingStore.getState().status).toBe('idle');
  });

  it('starts the sport the athlete last recorded, and says so on the button', () => {
    useRecordingPreferences.setState({ recentActivityTypes: ['Run', 'Ride'] });
    render(<RecordScreen />);

    expect(screen.getByTestId('record-start')).toHaveTextContent(/Run/);
    fireEvent.press(screen.getByTestId('record-start'));
    expect(navigateTo).toHaveBeenCalledWith('/recording/Run?from=entry');
  });

  it('a chip chooses the sport without leaving the screen', () => {
    render(<RecordScreen />);

    fireEvent.press(screen.getByTestId('record-type-Walk'));
    expect(navigateTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('record-start')).toHaveTextContent(/Walk/);

    fireEvent.press(screen.getByTestId('record-start'));
    expect(navigateTo).toHaveBeenCalledWith('/recording/Walk?from=entry');
  });

  it('a sport chosen from More joins the chips and is the one Start starts', async () => {
    const entry = render(<RecordScreen />);

    fireEvent.press(entry.getByTestId('record-sport-more'));
    mockOpenedSheets.at(-1)!.settle({ kind: 'selected', value: 'GravelRide' });
    await act(async () => {});

    expect(entry.getByTestId('record-type-GravelRide')).toBeTruthy();
    fireEvent.press(entry.getByTestId('record-start'));
    expect(navigateTo).toHaveBeenCalledWith('/recording/GravelRide?from=entry');
  });

  it('keeps the sport when the sheet is dismissed without a choice', async () => {
    const entry = render(<RecordScreen />);

    fireEvent.press(entry.getByTestId('record-sport-more'));
    expect(mockOpenedSheets.at(-1)).toMatchObject({
      route: 'sheets/activity-type',
      input: { selectedType: 'Ride', mode: 'recording' },
    });
    mockOpenedSheets.at(-1)!.settle({ kind: 'cancelled' });
    await act(async () => {});
    fireEvent.press(entry.getByTestId('record-start'));
    expect(navigateTo).toHaveBeenCalledWith('/recording/Ride?from=entry');
  });

  it('swaps the map for the sport surface indoors', async () => {
    const entry = render(<RecordScreen />);
    expect(entry.getByTestId('recording-map')).toBeTruthy();

    fireEvent.press(entry.getByTestId('record-sport-more'));
    mockOpenedSheets.at(-1)!.settle({ kind: 'selected', value: 'VirtualRide' });
    await act(async () => {});
    expect(entry.queryByTestId('recording-map')).toBeNull();
    expect(entry.getByTestId('record-surface-indoor')).toBeTruthy();
  });

  it('opens on the manual surface when the last sport is entered by hand', () => {
    useRecordingPreferences.setState({ recentActivityTypes: ['Yoga', 'Ride'] });
    render(<RecordScreen />);

    expect(screen.queryByTestId('recording-map')).toBeNull();
    expect(screen.getByTestId('record-surface-manual')).toBeTruthy();
    fireEvent.press(screen.getByTestId('record-start'));
    expect(navigateTo).toHaveBeenCalledWith('/recording/Yoga?from=entry');
  });
});

describe("today's planned workout", () => {
  it('is absent when nothing is planned, not an empty card', () => {
    render(<RecordScreen />);
    expect(screen.queryByTestId('record-event-77')).toBeNull();
  });

  it('follows a planned workout on the armed route with its event', () => {
    mockEvents = [planned];
    render(<RecordScreen />);

    fireEvent.press(screen.getByTestId('record-event-77'));
    expect(navigateTo).toHaveBeenCalledWith('/recording/Run?from=entry&pairedEventId=77');
  });

  it('appears when the engine stores the calendar body for today', () => {
    render(<RecordScreen />);
    expect(screen.queryByTestId('record-event-77')).toBeNull();

    mockEvents = [planned];
    act(() => {
      for (const listener of mockListeners.bodyStored ?? []) listener({ kind: 'calendar' });
    });

    expect(screen.getByTestId('record-event-77')).toBeTruthy();
  });

  it('does not re-read for a body of another kind', () => {
    render(<RecordScreen />);

    mockEvents = [planned];
    act(() => {
      for (const listener of mockListeners.bodyStored ?? []) listener({ kind: 'wellness' });
    });

    expect(screen.queryByTestId('record-event-77')).toBeNull();
  });

  it('still re-reads when a sync settles on the activities channel', () => {
    render(<RecordScreen />);

    mockEvents = [planned];
    act(() => {
      for (const listener of mockListeners.activities ?? []) listener();
    });

    expect(screen.getByTestId('record-event-77')).toBeTruthy();
  });

  it('clips the GPS warning line to the radius of the tint it wraps', async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
    });
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
    });
    render(<RecordScreen />);

    const line = await screen.findByTestId('record-gps-warning');
    const inner = StyleSheet.flatten(line.props.style) as ViewStyle;
    let ancestor = line.parent;
    while (
      ancestor &&
      (ancestor.props.style === line.props.style ||
        !StyleSheet.flatten(ancestor.props.style)?.backgroundColor)
    ) {
      ancestor = ancestor.parent;
    }
    const outer = StyleSheet.flatten(ancestor?.props.style) as ViewStyle;

    expect(outer.borderRadius).toBe(inner.borderRadius);
    expect(outer.overflow).toBe('hidden');
  });
});
