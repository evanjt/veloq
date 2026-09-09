/**
 * Scenario: an athlete who has never opened the recorder wants to change a
 * recording preference, or pair a heart-rate strap before a ride.
 *
 * Expected behaviour: the settings hub lists both screens. They were reachable
 * only from the record screen and from inside recording settings, so neither
 * was discoverable from Settings at all.
 */

import React from 'react';
import { render, within, fireEvent } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';
import { navigateTo } from '@/shared/app/navigation';
import { useSensorStore } from '@/features/sensors/store';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key);
  return { useTranslation: () => ({ t }) };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'outdoors', terrain3DMode: 'off' },
  }),
}));

jest.mock('@/shared/app/useAthlete', () => ({
  useAthlete: () => ({ athlete: null }),
}));

jest.mock('@/shared/storage/gpsStorage', () => ({
  getAppStorageSize: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/features/settings/lib/autobackup', () => ({
  getLastBackupTimestamp: jest.fn().mockReturnValue(null),
}));

// The hub reads the job list for the Background Jobs subtitle. What that list
// is computed from belongs to BackgroundJobsPanel's own tests.
jest.mock('@/features/settings', () => ({
  useBackgroundJobs: () => [{ id: 'sync', state: 'idle' }],
}));

jest.mock('@/features/settings/components', () => ({
  SupportSection: () => null,
  FooterSection: () => null,
}));

jest.mock('@/shared/app/navigation', () => ({
  navigateTo: jest.fn(),
}));

const go = navigateTo as jest.MockedFunction<typeof navigateTo>;

/** The nav row renders its title then its subtitle, so the subtitle is the last line. */
function subtitleOf(screen: ReturnType<typeof render>, testID: string): string {
  const row = screen.getByTestId(testID);
  const lines = within(row).getAllByText(/.+/);
  return String(lines[lines.length - 1].props.children);
}

function pair(count: number) {
  useSensorStore.setState({
    knownSensors: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      name: `Sensor ${i}`,
      kinds: ['heartRate' as const],
    })),
  });
}

describe('Settings hub, recording and sensors', () => {
  beforeEach(() => {
    go.mockClear();
    pair(0);
    useRecordingPreferences.setState({ gpsAccuracyMode: 'balanced' });
  });

  it('lists recording settings and opens it', () => {
    const screen = render(<SettingsScreen />);
    fireEvent.press(screen.getByTestId('settings-nav-recording'));
    expect(go).toHaveBeenCalledWith('/recording-settings');
  });

  it('lists sensors and opens the pairing screen', () => {
    const screen = render(<SettingsScreen />);
    fireEvent.press(screen.getByTestId('settings-nav-sensors'));
    expect(go).toHaveBeenCalledWith('/sensor-settings');
  });

  it('previews the GPS accuracy the recorder is set to', () => {
    const screen = render(<SettingsScreen />);
    expect(subtitleOf(screen, 'settings-nav-recording')).toBe('recording.gpsModes.balanced');

    useRecordingPreferences.setState({ gpsAccuracyMode: 'batterySaver' });
    screen.rerender(<SettingsScreen />);
    expect(subtitleOf(screen, 'settings-nav-recording')).toBe('recording.gpsModes.batterySaver');
  });

  it('says how many sensors are paired, and says so when none are', () => {
    const screen = render(<SettingsScreen />);
    expect(subtitleOf(screen, 'settings-nav-sensors')).toBe('sensors.nonePairedShort');

    pair(2);
    screen.rerender(<SettingsScreen />);
    expect(subtitleOf(screen, 'settings-nav-sensors')).toBe('sensors.pairedCount');
  });
});
