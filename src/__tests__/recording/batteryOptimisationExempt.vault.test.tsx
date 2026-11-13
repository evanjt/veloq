/**
 * Scenario: the record screen nudges the athlete to take the app off battery
 * optimisation, and the athlete has already done so, or does it from the nudge
 * and comes back.
 *
 * Expected behaviour: the nudge asks Android whether the app is exempt and
 * renders nothing when it is, and asks again on every return to the app. Where
 * there is no answer to read, it still shows until dismissed.
 */

import React from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { BatteryOptimisationNudge } from '@/features/recording/components/BatteryOptimisationNudge';
import { batteryOptimisationExempt } from '@/features/recording/lib/recordingNotification';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/ui/Button', () => {
  const { View } = require('react-native');
  return { ...jest.requireActual('@/shared/ui/Button'), Button: () => <View /> };
});
jest.mock('@/features/recording/lib/recordingNotification', () => ({
  batteryOptimisationExempt: jest.fn(),
}));

const preferences = {
  batteryOptDismissed: false,
  isLoaded: true,
  dismissBatteryOptNudge: () => {},
};
jest.mock('@/features/recording/stores/RecordingPreferencesStore', () => ({
  useRecordingPreferences: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(preferences),
}));

const exempt = batteryOptimisationExempt as jest.MockedFunction<typeof batteryOptimisationExempt>;
const appStateListeners: ((state: AppStateStatus) => void)[] = [];
const originalOS = Platform.OS;

function emitAppState(state: AppStateStatus) {
  act(() => {
    for (const listener of [...appStateListeners]) listener(state);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  preferences.batteryOptDismissed = false;
  appStateListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    listener: (state: AppStateStatus) => void
  ) => {
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners.splice(appStateListeners.indexOf(listener), 1);
      },
    };
  }) as never);
});

afterEach(() => {
  Platform.OS = originalOS;
});

describe('the battery optimisation nudge', () => {
  it('renders nothing when the app is already exempt', async () => {
    exempt.mockReturnValue(true);
    await render(<BatteryOptimisationNudge />);

    expect(screen.queryByTestId('battery-opt-nudge')).toBeNull();
  });

  it('shows while the app is still optimised', async () => {
    exempt.mockReturnValue(false);
    await render(<BatteryOptimisationNudge />);

    expect(screen.getByTestId('battery-opt-nudge')).toBeTruthy();
  });

  it('shows when there is no answer to read', async () => {
    exempt.mockReturnValue(null);
    await render(<BatteryOptimisationNudge />);

    expect(screen.getByTestId('battery-opt-nudge')).toBeTruthy();
  });

  it('clears on the return from settings where the exemption was granted', async () => {
    exempt.mockReturnValue(false);
    await render(<BatteryOptimisationNudge />);
    expect(screen.getByTestId('battery-opt-nudge')).toBeTruthy();

    exempt.mockReturnValue(true);
    emitAppState('background');
    expect(screen.getByTestId('battery-opt-nudge')).toBeTruthy();
    emitAppState('active');

    expect(screen.queryByTestId('battery-opt-nudge')).toBeNull();
  });

  it('comes back when the exemption is taken away while the app was away', async () => {
    exempt.mockReturnValue(true);
    await render(<BatteryOptimisationNudge />);
    expect(screen.queryByTestId('battery-opt-nudge')).toBeNull();

    exempt.mockReturnValue(false);
    emitAppState('active');

    expect(screen.getByTestId('battery-opt-nudge')).toBeTruthy();
  });

  it('stays dismissed whatever the exemption reads', async () => {
    preferences.batteryOptDismissed = true;
    exempt.mockReturnValue(false);
    await render(<BatteryOptimisationNudge />);

    expect(screen.queryByTestId('battery-opt-nudge')).toBeNull();
  });

  it('reads nothing off Android', async () => {
    Platform.OS = 'ios';
    await render(<BatteryOptimisationNudge />);

    expect(screen.queryByTestId('battery-opt-nudge')).toBeNull();
    expect(exempt).not.toHaveBeenCalled();
    expect(appStateListeners).toHaveLength(0);
  });
});
