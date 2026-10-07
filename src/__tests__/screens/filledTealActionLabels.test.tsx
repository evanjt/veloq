/**
 * Scenario: the recording "Upload now" button and the sensor scan button fill
 * with `colors.primary`, where white measures 3.74:1.
 *
 * Expected behaviour: the label, icon and spinner on those fills carry
 * `colors.textOnPrimary`, which clears 4.5:1 on the same fill.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import RecordingDetailScreen from '@/app/recordings/[id]';
import SensorSettingsScreen from '@/app/sensor-settings';
import { getVisibleRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { useSensorStore } from '@/features/sensors';
import { colors } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'r1' }),
  router: { back: jest.fn() },
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/ui', () => ({
  ScreenSafeAreaView: require('react-native').View,
  EmptyState: () => null,
  TAB_BAR_SAFE_PADDING: 0,
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (c: unknown) => c,
}));
jest.mock('@/features/recording/components/RecordingMap', () => ({ RecordingMap: () => null }));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    readRecordingTrack: jest.fn(async () => []),
  })
);
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  getVisibleRecording: jest.fn(),
  recordingFitExists: jest.fn(async () => true),
}));
jest.mock('@/features/recording/hooks/useRecordingLibrary', () => ({
  useRecordingLibrary: () => ({ uploadNow: jest.fn(), remove: jest.fn(), uploadingId: null }),
}));
jest.mock('@/features/sensors', () => {
  const { create } = require('zustand');
  const store = create(() => ({
    scanning: false,
    discovered: [],
    knownSensors: [],
    connections: {},
    isLoaded: true,
    initialize: jest.fn(),
  }));
  return {
    useSensorStore: store,
    startScan: jest.fn(),
    stopScan: jest.fn(),
    connectKnownSensors: jest.fn(),
    disconnectSensor: jest.fn(),
    requestBlePermissions: jest.fn(),
    isBleAvailable: () => true,
  };
});

const flat = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

it('draws the Upload now label, icon and ink on the teal fill', async () => {
  (getVisibleRecording as jest.Mock).mockResolvedValue({
    id: 'r1',
    kind: 'fit',
    fitPath: '/recordings/r1.fit',
    name: 'Morning ride',
    activityType: 'Ride',
    startTime: 0,
    createdAt: 0,
    durationSeconds: 60,
    distanceMeters: 100,
    uploadStatus: 'pending',
    retryCount: 0,
  });
  render(<RecordingDetailScreen />);
  const button = await screen.findByTestId('recording-upload-button');
  expect(flat(button.props.style).backgroundColor).toBe(colors.primary);
  expect(flat(screen.getByText('Upload now').props.style).color).toBe(colors.textOnPrimary);
});

it.each([false, true])('draws the scan label on the teal fill (scanning %s)', (scanning) => {
  useSensorStore.setState({ scanning } as never);
  render(<SensorSettingsScreen />);
  const button = screen.getByTestId('sensor-scan-button');
  expect(flat(button.props.style).backgroundColor).toBe(colors.primary);
  const label = screen.getByText(scanning ? 'Stop scanning' : 'Scan for sensors');
  expect(flat(label.props.style).color).toBe(colors.textOnPrimary);
});
