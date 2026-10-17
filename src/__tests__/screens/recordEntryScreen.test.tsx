/**
 * Scenario: the record button lands on the entry screen, and a tap there has to
 * read as a response before the clock appears. The tap used to start the ride
 * on arrival with nothing between, and raised the notification prompt over the
 * screen it opened.
 *
 * Expected behaviour: Start replaces the entry screen with the armed recording screen and does
 * nothing else, the chips choose the sport it starts, and today's planned
 * workouts follow the engine's calendar announcement. The notification dialog
 * is raised at most once ever, and while notifications or the lock-screen card
 * are off one line says the ride's controls stay inside the app.
 */
import React from 'react';
import { AppState, Linking, Platform, StyleSheet, type ViewStyle } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import RecordScreen from '@/app/record';
import { initialiseI18n } from '@/i18n';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { isLiveActivitySupported } from '@/features/recording/lib/liveActivity/bridge';
import { useAuthStore } from '@/shared/app/AuthStore';
import { replaceTo } from '@/shared/app/navigation';
import type { CalendarEvent } from '@/types';

type Listener = (payload?: unknown) => void;
const mockListeners: Record<string, Listener[]> = {};
let mockEvents: CalendarEvent[] = [];

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getCalendarEventBodies: () => mockEvents.map((event) => JSON.stringify(event)),
    syncCalendarEvents: jest.fn(),
    subscribe: (event: string, listener: Listener) => {
      (mockListeners[event] ??= []).push(listener);
      return () => {
        mockListeners[event] = mockListeners[event].filter((l) => l !== listener);
      };
    },
  }),
}));
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
}));
jest.mock('@/features/recording/lib/liveActivity/bridge', () => ({
  ...jest.requireActual('@/features/recording/lib/liveActivity/bridge'),
  isLiveActivityAvailable: jest.fn(() => true),
  isLiveActivitySupported: jest.fn(() => true),
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
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => React.ReactNode } }) =>
      options?.headerRight?.() ?? null,
  },
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
  category: 'WORKOUT',
  name: 'Threshold 3 x 4 min',
  type: 'Run',
  moving_time: 2400,
} as CalendarEvent;

const note: CalendarEvent = {
  id: 78,
  category: 'NOTE',
  name: 'Bike in for a service',
  type: 'Ride',
} as CalendarEvent;

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

const askRequested = () => (Notifications.requestPermissionsAsync as jest.Mock).mock.calls.length;

const initialisePreferences = useRecordingPreferences.getState().initialise;

beforeEach(() => {
  jest.clearAllMocks();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'undetermined',
    canAskAgain: true,
  });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
    canAskAgain: true,
  });
  mockOpenedSheets.length = 0;
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockEvents = [];
  useRecordingStore.getState().reset();
  useRecordingPreferences.setState({
    isLoaded: true,
    recentActivityTypes: [],
    notificationsAsked: false,
    initialise: initialisePreferences,
  } as never);
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
    await render(<RecordScreen />);

    await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled());
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

    await act(async () => {
      answerLocation({ status: 'granted' });
    });
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('record-start'));
    expect(replaceTo).toHaveBeenCalledWith('/recording/Ride?from=entry');
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing when a live session sends the athlete straight back to it', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await render(<RecordScreen />);

    await act(async () => {});
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('navigates to the armed recording screen and does nothing else', async () => {
    await render(<RecordScreen />);
    const asksBefore = askRequested();

    await fireEvent.press(screen.getByTestId('record-start'));

    expect(replaceTo).toHaveBeenCalledTimes(1);
    expect(replaceTo).toHaveBeenCalledWith('/recording/Ride?from=entry');
    expect(askRequested()).toBe(asksBefore);
    expect(useRecordingStore.getState().status).toBe('idle');
  });

  it('names the header cog for the recording settings it opens', async () => {
    await render(<RecordScreen />);

    expect(screen.getByTestId('record-settings').props.accessibilityLabel).toBe(
      'Recording Settings'
    );
  });

  it('starts the sport the athlete last recorded, and says so on the button', async () => {
    useRecordingPreferences.setState({ recentActivityTypes: ['Run', 'Ride'] });
    await render(<RecordScreen />);

    expect(screen.getByTestId('record-start')).toHaveTextContent(/Run/);
    await fireEvent.press(screen.getByTestId('record-start'));
    expect(replaceTo).toHaveBeenCalledWith('/recording/Run?from=entry');
  });

  it('a chip chooses the sport without leaving the screen', async () => {
    await render(<RecordScreen />);

    await fireEvent.press(screen.getByTestId('record-type-Walk'));
    expect(replaceTo).not.toHaveBeenCalled();
    expect(screen.getByTestId('record-start')).toHaveTextContent(/Walk/);

    await fireEvent.press(screen.getByTestId('record-start'));
    expect(replaceTo).toHaveBeenCalledWith('/recording/Walk?from=entry');
  });

  it('a sport chosen from More joins the chips and is the one Start starts', async () => {
    const entry = await render(<RecordScreen />);

    void fireEvent.press(entry.getByTestId('record-sport-more'));
    mockOpenedSheets.at(-1)!.settle({ kind: 'selected', value: 'GravelRide' });
    await act(async () => {});

    expect(entry.getByTestId('record-type-GravelRide')).toBeTruthy();
    await fireEvent.press(entry.getByTestId('record-start'));
    expect(replaceTo).toHaveBeenCalledWith('/recording/GravelRide?from=entry');
  });

  it('keeps the sport when the sheet is dismissed without a choice', async () => {
    const entry = await render(<RecordScreen />);

    void fireEvent.press(entry.getByTestId('record-sport-more'));
    expect(mockOpenedSheets.at(-1)).toMatchObject({
      route: 'sheets/activity-type',
      input: { selectedType: 'Ride', mode: 'recording' },
    });
    mockOpenedSheets.at(-1)!.settle({ kind: 'cancelled' });
    await act(async () => {});
    await fireEvent.press(entry.getByTestId('record-start'));
    expect(replaceTo).toHaveBeenCalledWith('/recording/Ride?from=entry');
  });

  it('swaps the map for the sport surface indoors', async () => {
    const entry = await render(<RecordScreen />);
    expect(entry.getByTestId('recording-map')).toBeTruthy();

    void fireEvent.press(entry.getByTestId('record-sport-more'));
    mockOpenedSheets.at(-1)!.settle({ kind: 'selected', value: 'VirtualRide' });
    await act(async () => {});
    expect(entry.queryByTestId('recording-map')).toBeNull();
    expect(entry.getByTestId('record-surface-indoor')).toBeTruthy();
  });

  it('opens on the manual surface when the last sport is entered by hand', async () => {
    useRecordingPreferences.setState({ recentActivityTypes: ['Yoga', 'Ride'] });
    await render(<RecordScreen />);

    expect(screen.queryByTestId('recording-map')).toBeNull();
    expect(screen.getByTestId('record-surface-manual')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('record-start'));
    expect(replaceTo).toHaveBeenCalledWith('/recording/Yoga?from=entry');
  });

  it('offers the rest of the sports from a Button named More', async () => {
    await render(<RecordScreen />);

    expect(screen.getByTestId('record-sport-more-label')).toHaveTextContent('More');
    expect(screen.getByRole('button', { name: 'More' })).toBe(
      screen.getByTestId('record-sport-more')
    );
  });
});

function notificationsAre(response: { status: string; canAskAgain: boolean }) {
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue(response);
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue(response);
}

describe('notifications on Android, which carry the ride outside the app', () => {
  const platform = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'android';
  });
  afterEach(() => {
    Platform.OS = platform;
  });

  it('raises the dialog once, not again on the next visit after a refusal', async () => {
    notificationsAre({ status: 'denied', canAskAgain: true });

    const first = await render(<RecordScreen />);
    await waitFor(() => expect(askRequested()).toBe(1));
    await first.unmount();

    await render(<RecordScreen />);
    await act(async () => {});
    expect(askRequested()).toBe(1);
  });

  it('asks nothing before the preferences load, or a restart would ask again', async () => {
    notificationsAre({ status: 'denied', canAskAgain: true });
    useRecordingPreferences.setState({ isLoaded: false });
    useRecordingPreferences.setState({ initialise: jest.fn(async () => undefined) } as never);

    await render(<RecordScreen />);
    await act(async () => {});
    expect(askRequested()).toBe(0);
  });

  it('says what a refusal costs, and Allow raises the dialog again while it can', async () => {
    notificationsAre({ status: 'denied', canAskAgain: true });
    useRecordingPreferences.setState({ notificationsAsked: true } as never);
    await render(<RecordScreen />);

    const notice = await screen.findByTestId('record-outside-app-notice');
    expect(notice).toHaveTextContent(/outside the app/);
    expect(askRequested()).toBe(0);

    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
    });
    await act(async () => {
      await fireEvent.press(screen.getByText('Allow'));
    });
    expect(askRequested()).toBe(1);
    await waitFor(() => expect(screen.queryByTestId('record-outside-app-notice')).toBeNull());
  });

  it('offers the app settings once the system will not ask again', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    notificationsAre({ status: 'denied', canAskAgain: false });
    await render(<RecordScreen />);

    await screen.findByTestId('record-outside-app-notice');
    expect(screen.queryByText('Allow')).toBeNull();
    await fireEvent.press(screen.getByText('Open settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(askRequested()).toBe(0);
    openSettings.mockRestore();
  });

  it('drops the line when the athlete comes back from settings having allowed them', async () => {
    notificationsAre({ status: 'denied', canAskAgain: false });
    await render(<RecordScreen />);
    await screen.findByTestId('record-outside-app-notice');

    notificationsAre({ status: 'granted', canAskAgain: true });
    const appStateListeners = (AppState.addEventListener as jest.Mock).mock.calls
      .filter(([event]) => event === 'change')
      .map(([, listener]) => listener as (state: string) => void);
    await act(async () => {
      for (const listener of appStateListeners) listener('active');
    });

    expect(screen.queryByTestId('record-outside-app-notice')).toBeNull();
  });

  it('shows nothing and asks nothing when notifications are allowed', async () => {
    notificationsAre({ status: 'granted', canAskAgain: true });
    await render(<RecordScreen />);

    await act(async () => {});
    expect(screen.queryByTestId('record-outside-app-notice')).toBeNull();
    expect(askRequested()).toBe(0);
  });

  it('never stands between the athlete and Start', async () => {
    notificationsAre({ status: 'denied', canAskAgain: false });
    await render(<RecordScreen />);
    await screen.findByTestId('record-outside-app-notice');

    await fireEvent.press(screen.getByTestId('record-start'));
    expect(replaceTo).toHaveBeenCalledWith('/recording/Ride?from=entry');
  });
});

describe('the lock-screen card on iOS', () => {
  const platform = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'ios';
    Object.defineProperty(Platform, 'isPad', { value: false, configurable: true });
  });
  afterEach(() => {
    Platform.OS = platform;
    Object.defineProperty(Platform, 'isPad', { value: false, configurable: true });
    (isLiveActivitySupported as jest.Mock).mockReturnValue(true);
  });

  it('says the controls stay in the app when Live Activities are off', async () => {
    (isLiveActivitySupported as jest.Mock).mockReturnValue(false);
    await render(<RecordScreen />);

    const notice = await screen.findByTestId('record-outside-app-notice');
    expect(notice).toHaveTextContent(/lock screen/);
    expect(screen.getByText('Open settings')).toBeTruthy();
    expect(askRequested()).toBe(0);
  });

  it('shows nothing while the card is on', async () => {
    await render(<RecordScreen />);
    await act(async () => {});
    expect(screen.queryByTestId('record-outside-app-notice')).toBeNull();
  });

  it('shows nothing on a tablet, which has no lock-screen card to turn on', async () => {
    Object.defineProperty(Platform, 'isPad', { value: true, configurable: true });
    (isLiveActivitySupported as jest.Mock).mockReturnValue(false);
    await render(<RecordScreen />);
    await act(async () => {});
    expect(screen.queryByTestId('record-outside-app-notice')).toBeNull();
  });
});

describe("today's planned workout", () => {
  it('is absent when nothing is planned, not an empty card', async () => {
    await render(<RecordScreen />);
    expect(screen.queryByTestId('record-event-77')).toBeNull();
  });

  it('follows a planned workout on the armed route with its event', async () => {
    mockEvents = [planned];
    await render(<RecordScreen />);

    await fireEvent.press(screen.getByTestId('record-event-77'));
    expect(replaceTo).toHaveBeenCalledWith('/recording/Run?from=entry&pairedEventId=77');
  });

  it('offers only the workout when a note shares its day', async () => {
    mockEvents = [note, planned];
    await render(<RecordScreen />);

    expect(screen.getByTestId('record-event-77')).toBeTruthy();
    expect(screen.queryByTestId('record-event-78')).toBeNull();
  });

  it('appears when the engine stores the calendar body for today', async () => {
    await render(<RecordScreen />);
    expect(screen.queryByTestId('record-event-77')).toBeNull();

    mockEvents = [planned];
    await act(() => {
      for (const listener of mockListeners.bodyStored ?? []) listener({ kind: 'calendar' });
    });

    expect(screen.getByTestId('record-event-77')).toBeTruthy();
  });

  it('does not re-read for a body of another kind', async () => {
    await render(<RecordScreen />);

    mockEvents = [planned];
    await act(() => {
      for (const listener of mockListeners.bodyStored ?? []) listener({ kind: 'wellness' });
    });

    expect(screen.queryByTestId('record-event-77')).toBeNull();
  });

  it('still re-reads when a sync settles on the activities channel', async () => {
    await render(<RecordScreen />);

    mockEvents = [planned];
    await act(() => {
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
    await render(<RecordScreen />);

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

describe('the bottom edge', () => {
  it('clears the home indicator once, through the safe area alone', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={{ top: 47, left: 0, right: 0, bottom: 34 }}>
        <RecordScreen />
      </SafeAreaInsetsContext.Provider>
    );

    const safeArea = screen.UNSAFE_getByType(SafeAreaView);
    const fromSafeArea = safeArea.props.edges.includes('bottom') ? 34 : 0;
    let node = screen.getByTestId('record-start').parent;
    let fromPanel: number | undefined;
    while (node && fromPanel === undefined) {
      const padding = StyleSheet.flatten(node.props.style)?.paddingBottom;
      if (typeof padding === 'number') fromPanel = padding;
      node = node.parent;
    }
    expect((fromPanel ?? 0) + fromSafeArea).toBe(34);
  });
});
